/**
 * speech-generation-info.ts — generated from shared/speech-generation-info.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/speech-generation-info.ts — 语音合成任务冻结元数据的唯一定义。
 *
 * 这是"这次请求合成的是什么"的可显示事实：原文、供应商/模型/音色身份、倍率与
 * 格式。它挂在既有 `task.metadata.speech` 上，随后台结果一起交付给 renderer /
 * SDK 消费，因此本文件不引入任何 Node 专有 API（`Buffer` / `fs` / `path`），
 * UTF-8 字节长度用 `TextEncoder` 计算，保证在浏览器侧同样可用。
 *
 * 白名单是刻意的：只保留下面这几个字段，凭据、baseUrl、headers、base64、
 * 原始 params 一律不在此列。normalize 只做白名单拷贝——缺字段或旧版本返回
 * null，绝不用"当前默认模型"去猜历史任务的值。
 *
 * 这一层不认识任何具体供应商：格式用共享的 AudioFormat，倍率只要求有限正数。
 * "豆包只支持 mp3 / 0.5..2"这类约束属于该模型声明与适配器能力，不写进这里，
 * 否则第二个供应商要么被误拒要么被伪称可用。
 */
import { type AudioFormat } from "./audio-contract.js";
export declare const SPEECH_GENERATION_INFO_VERSION = 1;
/** 宿主输入的 UTF-8 字节预算：Hana 的显式预算，不是厂商上限。 */
export declare const SPEECH_GENERATION_TEXT_MAX_BYTES: number;
/** 身份/显示字符串的上界，避免异常长的字段进入持久数据与事件。 */
export declare const SPEECH_GENERATION_IDENTIFIER_MAX_BYTES = 512;
export interface SpeechGenerationInfo {
    readonly version: 1;
    readonly text: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly voiceId: string;
    readonly voiceLabel?: string;
    readonly modelLabel?: string;
    /** 供应商中立倍率（有限正数）；具体范围由模型声明与适配器能力校验。 */
    readonly speed: number;
    readonly format: AudioFormat;
}
/** UTF-8 字节长度；浏览器与服务端同一实现。 */
export declare function utf8ByteLength(value: string): number;
/**
 * 把任意来源的值归一成 v1 白名单。缺字段、版本不符、字段非法一律返回 null：
 * 调用方（Poller / 渲染器）据 null 走"没有可显示元数据"的既有路径，而不是
 * 补一个猜测值。
 */
export declare function normalizeSpeechGenerationInfo(value: unknown): SpeechGenerationInfo | null;
/**
 * 任务行上冻结的语音元数据，已归一；没有或不可信时为 null。
 *
 * 只有真正的语音合成产物任务（type speech/audio）才读这个字段：旧 image/video
 * 任务恰好也叫 metadata.speech 时，不得被当成语音结果塞进新的 result 字段。
 */
export declare function speechGenerationInfoFromTask(task: unknown): SpeechGenerationInfo | null;
//# sourceMappingURL=speech-generation-info.d.ts.map