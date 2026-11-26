// Turns the microphone's own rate (often 44.1 or 48 kHz) into the 16 kHz the model hears. Each output sample is the
// average of the input samples it covers, which also keeps out the high notes the lower rate cannot hold. It keeps
// its place between calls, so pieces of any size join without a click. Imported by src/speech/worker.mjs and the tests.

export function createResampler(fromRate, toRate = 16000) {
  if (!(fromRate > 0 && toRate > 0)) throw new Error(`bad rates ${fromRate} -> ${toRate}`);
  const step = fromRate / toRate;
  let pos = 0;
  let sum = 0;
  let count = 0;
  return function resample(input) {
    if (fromRate === toRate) return Float32Array.from(input);
    const out = new Float32Array(Math.ceil((input.length + count) / step) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i];
      count++;
      pos += 1;
      if (pos >= step) {
        out[n++] = sum / count;
        pos -= step;
        sum = 0;
        count = 0;
      }
    }
    return out.slice(0, n);
  };
}
