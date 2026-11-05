// Design Ref: DESIGN.md §4 단계 2, §4.4 — 스캔본 등기부등본(PDF)의 표 내용을 글자 그대로 옮겨 적는다. (PLAN 8번)
// 글자 읽기 서비스: OpenAI (2026-11-04 사용자 결정, 지금은 가짜 서류만 보냄).
// ⚠ 실제 의뢰인 서류를 보내기 전에 OpenAI의 데이터 보관 조건(PRD: 저장하지 않는 설정)을 다시 확인할 것.
// - 서버 코드에서만 쓴다. 키는 .env의 OPENAI_API_KEY (브라우저에 노출 금지).
// - 요청에 store:false 를 넣어 응답을 OpenAI 쪽에 저장하지 않도록 한다.
// - 주민등록번호 등 대조 항목이 아닌 정보는 받을 모양(스키마)에 아예 없다.
// - 서류 내용과 읽은 원문은 로그에 남기지 않는다.
import "server-only";
import { voteRegistryReads } from "./ocrVote";
import { prepareScanStrips } from "./scanImage";

/** 읽은 값 하나: 글자 그대로 + 불확실 여부 */
export interface OcrValue {
  text: string | null;
  uncertain: boolean;
}

export interface RegistryTransfer {
  rank: string; // 예: "1-1"
  receiptNumber: OcrValue;
  registrationDate: OcrValue;
  assignee: OcrValue; // 부기등기의 근저당권자 (양수인)
  assigneeIdFront: OcrValue; // 그 등록번호의 앞 6자리만
}

export interface RegistryMortgage {
  rank: string; // 예: "1"
  receiptNumber: OcrValue;
  registrationDate: OcrValue;
  maxClaimAmount: OcrValue;
  debtors: OcrValue[];
  mortgagee: OcrValue;
  mortgageeIdFront: OcrValue; // 근저당권자 등록번호의 앞 6자리만
  transfers: RegistryTransfer[];
}

export interface RegistryRead {
  properties: { location: OcrValue; lotNumber: OcrValue; unitNumber: OcrValue; area: OcrValue }[];
  owners: OcrValue[];
  mortgages: RegistryMortgage[];
}

export class RegistryReadError extends Error {}

const V = {
  type: "object",
  additionalProperties: false,
  required: ["text", "uncertain"],
  properties: {
    text: { type: ["string", "null"] },
    uncertain: { type: "boolean" },
  },
} as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["properties", "owners", "mortgages"],
  properties: {
    properties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["location", "lotNumber", "unitNumber", "area"],
        properties: { location: V, lotNumber: V, unitNumber: V, area: V },
      },
    },
    owners: { type: "array", items: V },
    mortgages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "receiptNumber", "registrationDate", "maxClaimAmount", "debtors", "mortgagee", "mortgageeIdFront", "transfers"],
        properties: {
          rank: { type: "string" },
          receiptNumber: V,
          registrationDate: V,
          maxClaimAmount: V,
          debtors: { type: "array", items: V },
          mortgagee: V,
          mortgageeIdFront: V,
          transfers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["rank", "receiptNumber", "registrationDate", "assignee", "assigneeIdFront"],
              properties: { rank: { type: "string" }, receiptNumber: V, registrationDate: V, assignee: V, assigneeIdFront: V },
            },
          },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `당신은 스캔된 한국 부동산 등기사항전부증명서의 표 내용을 글자 그대로 옮겨 적는 도구입니다.
반드시 지킬 것:
- 보이는 글자를 한 글자도 고치거나 바꾸지 말고 그대로 적는다. 오타처럼 보여도 고치지 않는다. 띄어쓰기도 보이는 대로.
- 추측하지 않는다. 칸이 없거나 읽을 수 없으면 text를 null로 둔다.
- 한 글자라도 흐리거나 확실하지 않으면 uncertain을 true로 한다. 확실할 때만 false.
- 주민등록번호·법인등록번호는 앞 6자리만 적고(아래 IdFront 칸), 뒷자리는 절대 적지 않는다. 주소, 지분, 거래가액 등 아래에 없는 정보는 적지 않는다. 이름 칸에는 이름(상호)만 적는다.
양식(집합건물 등기사항증명서): 표제부(1동의 건물의 표시) → (대지권의 목적인 토지의 표시) → 표제부(전유부분의 건물의 표시) → (대지권의 표시) → 갑구 → 을구.
옮겨 적을 내용:
- properties: 전유부분마다 하나씩.
  - location, lotNumber: 「표제부(1동의 건물의 표시)」의 소재지번 칸에서 소재(동·리·가까지)와 지번(숫자와 '-'만). 건물명칭·도로명주소는 빼기.
  - unitNumber: 「표제부(전유부분의 건물의 표시)」의 건물번호 그대로 (예: "제8층 제802호"). 없으면 빈 문자열 "".
  - area: 「표제부(전유부분의 건물의 표시)」 건물내역의 면적 숫자와 단위만 (예: "86.08㎡"). 구조 설명은 빼기. 대지권의 목적인 토지의 면적이나 대지권비율은 쓰지 않는다.
- owners: 갑구의 현재 소유자. 맨 마지막 소유권 등기(소유권이전 또는 소유권보존) 줄의 소유자·공유자 이름마다 하나씩. 그 전 줄의 옛 소유자는 넣지 않는다.
- mortgages: 을구의 "근저당권설정" 주등기마다 하나씩. rank는 순위번호, receiptNumber는 접수 칸의 "제…호", registrationDate는 접수 칸의 날짜, maxClaimAmount는 "금 …원" 그대로, debtors는 채무자 이름마다(주소 빼기), mortgagee는 근저당권자 이름(등록번호·주소 빼기), mortgageeIdFront는 그 근저당권자 등록번호의 '-' 앞 6자리 숫자만.
- transfers: 그 근저당권 아래의 "근저당권이전" 부기등기마다 하나씩 (순위번호가 "1-1"처럼 붙은 것). receiptNumber·registrationDate는 그 부기등기의 접수 칸, assignee는 그 부기등기의 근저당권자 이름(등록번호·주소 빼기), assigneeIdFront는 그 등록번호의 '-' 앞 6자리 숫자만.`;

/** 응답에서 글자 부분을 꺼낸다 (Responses API) */
function outputText(json: unknown): string | null {
  const out = (json as { output?: { type: string; content?: { type: string; text?: string }[] }[] }).output ?? [];
  for (const item of out) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) return c.text;
  }
  return null;
}

/**
 * 스캔 PDF 안에 들어 있는 JPEG 사진(페이지 스캔)을 꺼낸다.
 * 스캐너가 만든 PDF는 대개 페이지마다 JPEG(DCTDecode) 한 장이다. 꺼내지 못하면 빈 목록.
 */
export function extractJpegPages(pdf: Buffer | Uint8Array): Buffer[] {
  const b = Buffer.from(pdf);
  const pages: Buffer[] = [];
  let from = 0;
  for (;;) {
    const filter = b.indexOf("/DCTDecode", from, "latin1");
    if (filter === -1) break;
    const streamKw = b.indexOf("stream", filter, "latin1");
    if (streamKw === -1) break;
    let start = streamKw + "stream".length;
    if (b[start] === 0x0d) start++;
    if (b[start] === 0x0a) start++;
    const end = b.indexOf("endstream", start, "latin1");
    if (end === -1) break;
    // JPEG는 FFD8로 시작해 FFD9로 끝난다
    const eoi = b.lastIndexOf(Buffer.from([0xff, 0xd9]), end);
    if (b[start] === 0xff && b[start + 1] === 0xd8 && eoi > start) pages.push(b.subarray(start, eoi + 2));
    from = end;
  }
  return pages;
}

/** 등기부 PDF를 보내 표 내용을 받는다. 실패하면 RegistryReadError. */
export async function readRegistryPdf(pdf: Buffer | Uint8Array, signal?: AbortSignal): Promise<RegistryRead> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new RegistryReadError("글자 읽기 서비스 키(OPENAI_API_KEY)가 설정되지 않았습니다.");
  const model = process.env.OPENAI_MODEL || "gpt-5.5";

  // 스캔 사진을 꺼낼 수 있으면 여백을 자르고 조각내 고해상도로 보내고(작은 글자를 더 잘 읽음), 아니면 PDF 그대로 보낸다
  const jpegs = extractJpegPages(pdf);
  const docParts: Record<string, unknown>[] = [];
  let note = "";
  if (jpegs.length > 0) {
    let pageNo = 0;
    for (const page of jpegs) {
      pageNo++;
      const strips = await prepareScanStrips(page);
      strips.forEach((s, i) => {
        docParts.push({ type: "input_text", text: `[${pageNo}쪽 조각 ${i + 1}/${strips.length}${s.overlapsPrevious ? ", 앞 조각과 위쪽이 겹침" : ""}]` });
        docParts.push({ type: "input_image", detail: "high", image_url: `data:image/jpeg;base64,${s.jpeg.toString("base64")}` });
      });
    }
    note =
      "\n아래 사진들은 등기부 페이지를 위에서 아래로 차례로 자른 조각입니다. 순서대로 이어 붙여 한 문서로 읽으세요. " +
      "'겹침'이라고 표시된 조각은 앞 조각과 위쪽 일부가 같으니 같은 줄을 두 번 적지 마세요.";
  } else {
    docParts.push({ type: "input_file", filename: "registry.pdf", file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}` });
  }

  const body = JSON.stringify({
    model,
    store: false,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [...docParts, { type: "input_text", text: "이 등기사항전부증명서의 내용을 지정된 형식으로 옮겨 적어 주세요." + note }],
      },
    ],
    text: { format: { type: "json_schema", name: "registry", strict: true, schema: SCHEMA } },
  });

  const readOnce = async (): Promise<RegistryRead> => {
    // 사용량 한도(429)·일시 오류(5xx)면 잠시 기다렸다 다시 시도한다 (최대 5번)
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
      });
      if (res.status === 429) {
        // 크레딧 소진(insufficient_quota)은 기다려도 풀리지 않으므로 바로 알린다
        const err = (await res.clone().json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
        if (err?.error?.type === "insufficient_quota" || err?.error?.code === "insufficient_quota" || err?.error?.code === "credit_balance_exhausted") {
          throw new RegistryReadError("글자 읽기 서비스(OpenAI) 크레딧이 소진됐습니다. 충전 후 다시 시도하세요.");
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 4) break;
      const after = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
    }
    if (!res.ok) {
      // 서류 내용이 섞이지 않도록 상태 코드만 남긴다
      throw new RegistryReadError(`글자 읽기 서비스 오류 (HTTP ${res.status})`);
    }
    const text = outputText(await res.json());
    if (!text) throw new RegistryReadError("글자 읽기 서비스가 빈 응답을 보냈습니다.");
    try {
      return JSON.parse(text) as RegistryRead;
    } catch {
      throw new RegistryReadError("글자 읽기 결과 형식이 올바르지 않습니다.");
    }
  };

  // 같은 서류를 여러 번(기본 3번) 읽어 값마다 다수결 (읽을 때마다 생기는 무작위 실수를 줄인다)
  const times = Math.max(1, Number(process.env.OCR_READS) || 3);
  const reads = await Promise.all(Array.from({ length: times }, readOnce));
  return voteRegistryReads(reads);
}
