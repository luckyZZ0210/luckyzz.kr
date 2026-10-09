# public/textures — asset provenance

## earth-landmask-2048.png

- **Source**: Natural Earth 1:50m Physical — `ne_50m_land`
  <https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/>
- **License**: Public Domain (Natural Earth terms)
  <https://www.naturalearthdata.com/about/terms-of-use/>
- **Format**: PNG, 2048×1024, 8-bit grayscale (L), binary — **land = 255, sea = 0** (AA off; smoothed by shader `smoothstep(0.35, 0.68)` per `docs/design/40-hero.md` §2.2).
- **Land fraction**: 0.3331 (includes Antarctica continent).
- **SHA1**: `9b73f6cf90f7ac6481dd118a5bf11208d889aa73`
- **Conversion**:
  1. Vector rasterisation (equirectangular 2048×1024, 4× supersample + box downscale) via
     `handoff/40d-assets/ne_raster.py ne_50m_land.geojson landmask-ne-2048.png`
     — produces the handoff artifact `handoff/40d-assets/landmask-ne-2048.png` (21 gray levels due to supersample).
  2. Binarise (threshold 128) and PNG-compress (level 9):
     `python3 -c "from PIL import Image; import numpy as np; im=np.asarray(Image.open('handoff/40d-assets/landmask-ne-2048.png').convert('L')); b=((im>=128).astype('uint8'))*255; Image.fromarray(b,'L').save('public/textures/earth-landmask-2048.png', optimize=True, compress_level=9)"`
- **Why binarise**: spec §2.2 requires AA off (shader handles coastline smoothing); binarising also drops file size from 62KB → 24KB.
