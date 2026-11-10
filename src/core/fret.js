// Equal-temperament fret math (12th root of 2), the same method the Fretboard Designer uses by default.
export const fretDistance = (scale, n) => scale * (1 - Math.pow(2, -n / 12));

// Fret number (fractional) at a distance d from the nut.
export const fretAt = (scale, d) => (d <= 0 ? 0 : d >= scale ? Infinity : -12 * Math.log2(1 - d / scale));
