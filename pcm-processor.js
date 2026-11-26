class PCM16InputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(0);
    this.ratio = sampleRate / 16000;
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const combined = new Float32Array(this.pending.length + input.length);
    combined.set(this.pending);
    combined.set(input, this.pending.length);
    this.pending = combined;

    const samplesPerChunk = 640; // 40 ms at 16 kHz
    const sourceLength = Math.ceil(samplesPerChunk * this.ratio) + 1;
    while (this.pending.length >= sourceLength) {
      const pcm = new Int16Array(samplesPerChunk);
      for (let i = 0; i < samplesPerChunk; i++) {
        const position = i * this.ratio;
        const left = Math.floor(position);
        const fraction = position - left;
        const value = this.pending[left] * (1 - fraction) + this.pending[left + 1] * fraction;
        const clipped = Math.max(-1, Math.min(1, value));
        pcm[i] = clipped < 0 ? clipped * 32768 : clipped * 32767;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      const consumed = Math.floor(samplesPerChunk * this.ratio);
      this.pending = this.pending.slice(consumed);
    }
    return true;
  }
}

registerProcessor('pcm16-input', PCM16InputProcessor);
