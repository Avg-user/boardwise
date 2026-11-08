// Voice dictation: turns microphone audio into 16 kHz mono 16-bit PCM, the format the speech
// service expects, and posts it to the page in ~100 ms chunks.
//
// We resample here instead of creating a 16 kHz AudioContext because Firefox can't connect a
// microphone to an AudioContext running at a different rate from the device.
// Each output sample is the average of the input samples it covers, which also filters out
// frequencies too high for 16 kHz.

const TARGET_RATE = 16000
const CHUNK_SAMPLES = 1600 // 100 ms

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_RATE // input samples per output sample
    this.sum = 0
    this.count = 0
    this.position = 0
    this.chunk = new Int16Array(CHUNK_SAMPLES)
    this.length = 0
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.post()
        this.port.postMessage('flushed')
      }
    }
  }

  post() {
    if (this.length === 0) return
    const buffer = this.chunk.slice(0, this.length).buffer
    this.port.postMessage(buffer, [buffer])
    this.length = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]
      this.count++
      this.position++
      if (this.position >= this.ratio) {
        this.position -= this.ratio
        const sample = Math.max(-1, Math.min(1, this.sum / this.count))
        this.chunk[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        this.sum = 0
        this.count = 0
        if (this.length === CHUNK_SAMPLES) this.post()
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
