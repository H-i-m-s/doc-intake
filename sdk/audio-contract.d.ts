/**
 * audio-contract.ts — generated from shared/audio-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/audio-contract.ts — 语音合成（TTS）的 typed 叶子契约。
 *
 * 这一层只描述"一次合成调用需要的输入"和"它吐出的流事件"，只做契约，不认识
 * engine、会话焦点、播放器或文件系统，也不携带任何具体供应商的能力清单
 * （mp3-only、preset-only、0.5..2、24000 这些属于某个适配器与模型声明，不写在
 * 共享类型里）。将来第二个供应商接入时，本文件的请求/事件类型无需改动。
 */
/** 已识别的音频格式集合（识别不代表已实现；实现对某格式的支持由适配器声明）。 */
export type AudioFormat = "mp3" | "wav" | "pcm" | "ogg_opus";
export declare const KNOWN_AUDIO_FORMATS: readonly AudioFormat[];
export declare function isKnownAudioFormat(value: unknown): value is AudioFormat;
/** 音色来源。preset=预置；cloned/designed 是将来能力。 */
export type VoiceSource = "preset" | "cloned" | "designed";
/**
 * 一次合成用哪个音色。providerId 是逻辑供应商；credentialProviderId /
 * credentialLaneId 指向真正持有凭据的槽位。voiceId 是供应商原生音色 ID。
 */
export interface VoiceRef {
    readonly providerId: string;
    readonly credentialProviderId?: string;
    readonly credentialLaneId?: string;
    readonly modelId: string;
    readonly voiceId: string;
    readonly source: VoiceSource;
}
/** 已经解析完毕、可直接交给适配器的一次合成请求。 */
export interface SpeechSynthesisRequest {
    readonly text: string;
    readonly voice: VoiceRef;
    /** 供应商中立的倍率（有限正数；1=原速）。具体范围由适配器校验。 */
    readonly speed: number;
    readonly format: AudioFormat;
    /** 请求的采样率/声道（请求值，不是探测到的实际值）。 */
    readonly requestedSampleRate?: number;
    readonly requestedChannels?: number;
    /** 调用方生成的操作标识（UUID 形状由适配器/包装边界保证）。 */
    readonly requestId: string;
}
/** 仅在服务端可见的凭据；绝不进入任务持久数据、日志或返回体。 */
export interface SpeechSynthesisCredentials {
    readonly apiKey: string;
    readonly baseUrl: string;
    /**
     * 豆包 TTS：标准按量端点 vs 方舟 Agent Plan 端点。缺省 / 未知值按 standard，
     * 保持既有用户路径不变。其他供应商忽略此字段。
     */
    readonly endpointMode?: "standard" | "agent-plan";
}
/**
 * 事件顺序固定：start → audio(0..n) → done，且 done 恰好一次。
 * start 的 sampleRate/channels 只在确有探测/证据时给出；请求值不得冒充实测值。
 */
export interface SpeechSynthesisStartEvent {
    readonly type: "start";
    readonly format: AudioFormat;
    readonly sampleRate?: number;
    readonly channels?: number;
}
export interface SpeechSynthesisAudioEvent {
    readonly type: "audio";
    readonly chunk: Uint8Array;
}
export interface SpeechSynthesisDoneEvent {
    readonly type: "done";
    /** 有限元数据：供应商 requestId（如回带）与用量；无则 null。 */
    readonly requestId: string | null;
    readonly usage: {
        readonly textWords?: number;
    } | null;
}
export type SpeechSynthesisEvent = SpeechSynthesisStartEvent | SpeechSynthesisAudioEvent | SpeechSynthesisDoneEvent;
export interface SpeechSynthesizeOptions {
    readonly credentials: SpeechSynthesisCredentials;
    /** 明确的取消信号：中断时必须立刻停止 fetch 与读取。 */
    readonly signal: AbortSignal;
    /** 可注入 fetch，便于测试；缺省用全局 fetch。 */
    readonly fetch?: typeof fetch;
}
/**
 * 合成器：吃已解析的请求 + 服务端凭据 + 明确 signal，吐异步事件流。
 * 所有在途状态归单次调用与 signal，不用模块级 current* 或共享 buffer。
 */
export interface SpeechSynthesizer {
    synthesize(request: SpeechSynthesisRequest, options: SpeechSynthesizeOptions): AsyncIterable<SpeechSynthesisEvent>;
}
//# sourceMappingURL=audio-contract.d.ts.map