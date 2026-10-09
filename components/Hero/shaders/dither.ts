// Ordered Bayer 8x8 dithering postprocess fragment shader.
// Samples a scene texture, converts to luminance, and threshold-quantizes
// against the Bayer matrix for a halftone-ish black & white look.

export const ditherVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ditherFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform float uPixelSize;   // pixel block size for chunky look
  uniform float uContrast;    // 1.0 = linear; >1 steepens

  // 8x8 Bayer matrix (values 0..63 scaled to 0..1 with +0.5 offset)
  float bayer8(vec2 p) {
    int x = int(mod(p.x, 8.0));
    int y = int(mod(p.y, 8.0));
    int idx = y * 8 + x;
    // Precomputed 8x8 Bayer matrix
    float m[64];
    m[0]=0.0;  m[1]=32.0; m[2]=8.0;  m[3]=40.0; m[4]=2.0;  m[5]=34.0; m[6]=10.0; m[7]=42.0;
    m[8]=48.0; m[9]=16.0; m[10]=56.0;m[11]=24.0;m[12]=50.0;m[13]=18.0;m[14]=58.0;m[15]=26.0;
    m[16]=12.0;m[17]=44.0;m[18]=4.0; m[19]=36.0;m[20]=14.0;m[21]=46.0;m[22]=6.0; m[23]=38.0;
    m[24]=60.0;m[25]=28.0;m[26]=52.0;m[27]=20.0;m[28]=62.0;m[29]=30.0;m[30]=54.0;m[31]=22.0;
    m[32]=3.0; m[33]=35.0;m[34]=11.0;m[35]=43.0;m[36]=1.0; m[37]=33.0;m[38]=9.0; m[39]=41.0;
    m[40]=51.0;m[41]=19.0;m[42]=59.0;m[43]=27.0;m[44]=49.0;m[45]=17.0;m[46]=57.0;m[47]=25.0;
    m[48]=15.0;m[49]=47.0;m[50]=7.0; m[51]=39.0;m[52]=13.0;m[53]=45.0;m[54]=5.0; m[55]=37.0;
    m[56]=63.0;m[57]=31.0;m[58]=55.0;m[59]=23.0;m[60]=61.0;m[61]=29.0;m[62]=53.0;m[63]=21.0;
    return (m[idx] + 0.5) / 64.0;
  }

  void main() {
    // Pixelate: quantize uv to blocks for chunky dither feel.
    vec2 pixel = max(uPixelSize, 1.0) / uResolution;
    vec2 snapped = (floor(vUv / pixel) + 0.5) * pixel;
    vec3 col = texture2D(uScene, snapped).rgb;

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    // Contrast adjust around mid-gray.
    lum = clamp(0.5 + (lum - 0.5) * uContrast, 0.0, 1.0);

    vec2 blockCoord = floor(vUv * uResolution / max(uPixelSize, 1.0));
    float threshold = bayer8(blockCoord);
    float v = lum > threshold ? 1.0 : 0.0;

    gl_FragColor = vec4(vec3(v), 1.0);
  }
`;
