// Scripted stand-in for the AI until the backend chat exists. No model is called.
// The wording follows the linked Government of Alberta pages, checked on 2026-11-07.
import type { SendMessageInput, SendMessageResult } from './chat.ts'
import type { ChatMessage, Citation } from './types.ts'

const OHS_PHONE = '1-866-415-8690'

const SOURCES = {
  harassment: {
    title: 'Workplace harassment and violence (Government of Alberta)',
    url: 'https://www.alberta.ca/workplace-harassment-violence',
  },
  whmis: {
    title: 'OHS Code, Part 29: WHMIS',
    url: 'https://search-ohs-laws.alberta.ca/legislation/occupational-health-and-safety-code/part-29-workplace-hazardous-materials-information-system-whmis/',
  },
  refuse: {
    title: 'Refuse dangerous work (Government of Alberta)',
    url: 'https://www.alberta.ca/refuse-dangerous-work',
  },
  report: {
    title: 'Report a health and safety concern (Government of Alberta)',
    url: 'https://www.alberta.ca/file-complaint-online',
  },
} satisfies Record<string, Citation>

type ScriptedReply = {
  text: Record<'en' | 'fr', string>
  steps: Record<'en' | 'fr', string[]>
  citations: Citation[]
}

const HARASSMENT_REPLY: ScriptedReply = {
  text: {
    en: "I'm an AI assistant, not a lawyer, so this is general information and not legal advice. In Alberta, harassment can be a single incident or repeated unwelcome conduct, comments, bullying or actions. Reasonable conduct by an employer or supervisor in managing workers doesn't count. Employers must, as far as reasonably practicable, make sure workers aren't subjected to harassment. They must also have a prevention plan and investigate incidents.",
    fr: "Je suis un assistant IA et non un avocat. Il s'agit donc de renseignements généraux et non d'un avis juridique. En Alberta, le harcèlement peut être un incident isolé ou des incidents répétés : conduite, commentaires, intimidation ou gestes importuns. La conduite raisonnable d'un employeur ou d'un superviseur dans la gestion du personnel n'en fait pas partie. Dans la mesure où cela est raisonnablement possible, l'employeur doit veiller à ce que les travailleurs ne subissent pas de harcèlement. Il doit aussi avoir un plan de prévention et enquêter sur les incidents.",
  },
  steps: {
    en: [
      'Write down dates, what happened and who saw it',
      "Ask how to report harassment under your employer's prevention plan",
      `Call Alberta OHS at ${OHS_PHONE} if you need help with next steps`,
    ],
    fr: [
      "Notez les dates, ce qui s'est passé et qui en a été témoin",
      'Demandez comment signaler le harcèlement selon le plan de prévention de votre employeur',
      `Appelez la SST de l'Alberta au ${OHS_PHONE} si vous avez besoin d'aide pour la suite`,
    ],
  },
  citations: [SOURCES.harassment],
}

const HAZARD_REPLY: ScriptedReply = {
  text: {
    en: "I'm an AI assistant, not a lawyer, so this is general information and not legal advice. In Alberta, employers must keep safety data sheets readily available to workers who may be exposed to a hazardous product, and train workers who work with or near one. You can also refuse work you reasonably believe poses an undue hazard, meaning a serious, immediate threat. Employers can't take or threaten disciplinary action against you for this.",
    fr: "Je suis un assistant IA et non un avocat. Il s'agit donc de renseignements généraux et non d'un avis juridique. En Alberta, l'employeur doit garder les fiches de données de sécurité facilement accessibles aux travailleurs qui peuvent être exposés à un produit dangereux, et former ceux qui travaillent avec ce produit ou à proximité. Vous pouvez aussi refuser un travail qui, selon vous et pour des motifs raisonnables, présente un danger indu, c'est-à-dire une menace grave et immédiate. L'employeur ne peut ni prendre ni menacer de prendre de mesures disciplinaires contre vous pour cette raison.",
  },
  steps: {
    en: [
      'Write down which product it is and when symptoms started',
      "Ask to see the product's safety data sheet",
      `Report the concern to Alberta OHS online or at ${OHS_PHONE}. You can ask to remain anonymous`,
    ],
    fr: [
      'Notez de quel produit il s’agit et quand les symptômes ont commencé',
      'Demandez à voir la fiche de données de sécurité du produit',
      `Signalez le problème à la SST de l'Alberta en ligne ou au ${OHS_PHONE}. Vous pouvez demander l'anonymat`,
    ],
  },
  citations: [SOURCES.whmis, SOURCES.refuse, SOURCES.report],
}

const HAZARD_PATTERN =
  /\b(solvents?|chemicals?|fumes?|hazard\w*|unsafe|dangerous|asbestos|produits? chimiques?|vapeurs?|danger\w*)\b/i

// Only here so the crisis state can be demonstrated. Real detection belongs on the
// backend, before any model call, and this short list must not be reused for it.
const CRISIS_PATTERN =
  /\b(suicide|suicidal|kill (me|myself)|hurt (me|myself)|end my life|weapon|in danger|me tuer|me suicider|arme|en danger)\b/i

const STREAM_DELAY_MS = 30

const messagesByConversation = new Map<number, ChatMessage[]>()
// Negative IDs can't collide with real database IDs.
let nextId = -1

function createMessage(
  conversationId: number,
  message: Pick<ChatMessage, 'role' | 'content'> & Partial<ChatMessage>,
): ChatMessage {
  const created: ChatMessage = {
    id: nextId--,
    flagged_crisis: false,
    created_at: new Date().toISOString(),
    citations: [],
    suggested_steps: [],
    ...message,
  }
  const messages = messagesByConversation.get(conversationId) ?? []
  messagesByConversation.set(conversationId, [...messages, created])
  return created
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export async function sendMockMessage({
  conversationId,
  content,
  language,
  onDelta,
  signal,
}: SendMessageInput): Promise<SendMessageResult> {
  const isCrisis = CRISIS_PATTERN.test(content)
  const userMessage = createMessage(conversationId, {
    role: 'user',
    content,
    flagged_crisis: isCrisis,
  })
  if (isCrisis) {
    return { userMessage, reply: null }
  }

  const script = HAZARD_PATTERN.test(content) ? HAZARD_REPLY : HARASSMENT_REPLY
  const lang = language.startsWith('fr') ? 'fr' : 'en'
  const text = script.text[lang]

  for (const piece of text.match(/\S+\s*/g) ?? []) {
    await wait(STREAM_DELAY_MS, signal)
    onDelta?.(piece)
  }

  const reply = createMessage(conversationId, {
    role: 'assistant',
    content: text,
    citations: script.citations,
    suggested_steps: script.steps[lang].map((title) => ({ title })),
  })
  return { userMessage, reply }
}

export function getMockMessages(conversationId: number): ChatMessage[] {
  return messagesByConversation.get(conversationId) ?? []
}

export function clearMockMessages() {
  messagesByConversation.clear()
}
