import { Readable } from "node:stream";

/** 将 AsyncIterable<string | Uint8Array> 转换为 Node 可读流 */
export function toReadable(iterable: AsyncIterable<string | Uint8Array>): Readable {
  return Readable.from(
    (async function* () {
      for await (const chunk of iterable) {
        yield typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
      }
    })(),
  );
}
