# WebGL 3D-Textur-Analyse: texImage3D Warnung-Quelle

**Analysedatum:** 8. April 2026  
**Ziel:** Identifizieren von texImage3D-Aufrufen und pixelStorei-Warnungen

---

## ZUSAMMENFASSUNG DER KRITISCHEN FUNDE

### 1. THREE.Data3DTexture & THREE.DataArrayTexture Verwendungen

#### Klassen-Definitionen:
- **[Data3DTexture.js](node_modules/three/src/textures/Data3DTexture.js#L1-L30)** — 3D-Textur-Klasse für Volumen-Daten
  - `this.isData3DTexture = true`
  - Standardeinstellungen: `flipY = false`, `unpackAlignment = 1`
  
- **[DataArrayTexture.js](node_modules/three/src/textures/DataArrayTexture.js#L1-L20)** — 2D-Array-Textur (für Layer-Stack)
  - `this.isDataArrayTexture = true`
  - Standardeinstellungen: `flipY = false`, `unpackAlignment = 1`

#### Sekundäre Definitionen (alle three.js):
- `node_modules/three/src/**` (Quellmodule)
- `js/vendor/three.min.js` (lokale Laufzeitkopie im Repo)

---

## KRITISCHE TEXIMAGE3D AUFRUFE

### A. WebGLTextures.js (Hauptrenderer-Einstiegspunkt)

**[node_modules/three/src/renderers/webgl/WebGLTextures.js](node_modules/three/src/renderers/webgl/WebGLTextures.js)**

#### 1. **Zeile ~730-750: uploadTexture() — pixelStorei KONFIGURATIONi**

```javascript
// WARNUNG-RISIKO: Diese pixelStorei-Aufrufe gelten auch für 3D-Texturen
_gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );
_gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha );
_gl.pixelStorei( _gl.UNPACK_ALIGNMENT, texture.unpackAlignment );
_gl.pixelStorei( _gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, unpackConversion );
```

**Kontext:** Diese Anweisungen werden VOR ALLEN Textur-Uploads ausgeführt, einschließlich 3D-Texturen.

---

#### 2. **Zeile ~1020-1025: Data3DTexture Upload**

```javascript
} else if ( texture.isData3DTexture ) {

    if ( useTexStorage ) {
        if ( allocateMemory ) {
            state.texStorage3D( _gl.TEXTURE_3D, levels, glInternalFormat, 
                                image.width, image.height, image.depth );
        }
        state.texSubImage3D( _gl.TEXTURE_3D, 0, 0, 0, 0,
                             image.width, image.height, image.depth, 
                             glFormat, glType, image.data );
    } else {
        // ⚠️ WARNUNG-HOTSPOT:
        state.texImage3D( _gl.TEXTURE_3D, 0, glInternalFormat,
                          image.width, image.height, image.depth, 
                          0, glFormat, glType, image.data );
    }
}
```

**Warum Warnung?** UNPACK_FLIP_Y und UNPACK_PREMULTIPLY_ALPHA sind auf 3D-Texturen möglicherweise ungültig/ignoriert.

---

#### 3. **Zeile ~1015-1022: DataArrayTexture Upload**

```javascript
} else if ( texture.isDataArrayTexture ) {

    if ( useTexStorage ) {
        if ( allocateMemory ) {
            state.texStorage3D( _gl.TEXTURE_2D_ARRAY, levels, glInternalFormat,
                                image.width, image.height, image.depth );
        }
        state.texSubImage3D( _gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0,
                             image.width, image.height, image.depth,
                             glFormat, glType, image.data );
    } else {
        // ⚠️ Ähnliche Warnung auch hier möglich:
        state.texImage3D( _gl.TEXTURE_2D_ARRAY, 0, glInternalFormat,
                          image.width, image.height, image.depth,
                          0, glFormat, glType, image.data );
    }
}
```

---

#### 4. **Zeile ~930-950: CompressedArrayTexture Upload**

```javascript
for ( let e = 0, i = A.length; e < i; e ++ ) {
    T = A[ e ];
    if ( a.format !== j ? null !== b ? ... 
        state.compressedTexImage3D( _gl.TEXTURE_2D_ARRAY, i, 
                                     glInternalFormat, mipmap.width, mipmap.height, image.depth, 
                                     0, mipmap.data, 0, 0 );
    ...
    } else {
        state.texImage3D( _gl.TEXTURE_2D_ARRAY, i, glInternalFormat,
                          mipmap.width, mipmap.height, image.depth,
                          0, glFormat, glType, mipmap.data );
    }
}
```

---

#### 5. **Zeile ~1365-1375: RenderTarget bei 3D-Texturen**

```javascript
K( e, r, a, o, c, h ) {  // setupRenderTargetFramebuffer
    ...
    if ( textureTarget === _gl.TEXTURE_3D || textureTarget === _gl.TEXTURE_2D_ARRAY ) {
        // ⚠️ Auch bei RenderTarget 3D-Texturen:
        state.texImage3D( textureTarget, level, glInternalFormat, 
                          width, height, renderTarget.depth, 
                          0, glFormat, glType, null );
    } else {
        state.texImage2D( ... );
    }
}
```

---

### B. WebGLState.js (WebGL State Wrapper)

**[node_modules/three/src/renderers/webgl/WebGLState.js](node_modules/three/src/renderers/webgl/WebGLState.js)**

#### Zeile ~375-385: pixelStorei Fehlerbehandlung

```javascript
function pixelStorei() {
    try {
        gl.pixelStorei.apply( gl, arguments );
    } catch( e ) {
        console.error( 'THREE.WebGLState:', e );
    }
}
```

Diese Error-Handler könnten überschrieben werden, wenn pixelStorei mit 3D-Texturen-Kontext aufgerufen wird.

#### Zeile ~1100-1110: texImage3D Wrapper

```javascript
function texImage3D() {
    try {
        gl.texImage3D.apply( gl, arguments );
    } catch( e ) {
        console.error( 'THREE.WebGLState:', e );
    }
}
```

---

### C. copyTextureToTexture3D (Kritisch für pixel-copy Operationen)

**[node_modules/three/src/renderers/WebGLRenderer.js](node_modules/three/src/renderers/WebGLRenderer.js#L2440-2520)**

```javascript
copyTextureToTexture3D( srcRegion, dstTexture, dstPosition, level = 0 ) {
    
    // ⚠️ WARNUNG-RISIKO — pixelStorei UND texSubImage3D gemeinsam:
    _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, dstTexture.flipY );
    _gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, dstTexture.premultiplyAlpha );
    _gl.pixelStorei( _gl.UNPACK_ALIGNMENT, dstTexture.unpackAlignment );
    
    const u = _gl.getParameter( _gl.UNPACK_ROW_LENGTH );
    const d = _gl.getParameter( _gl.UNPACK_IMAGE_HEIGHT );
    
    _gl.pixelStorei( _gl.UNPACK_ROW_LENGTH, g.width );
    _gl.pixelStorei( _gl.UNPACK_IMAGE_HEIGHT, g.height );
    _gl.pixelStorei( _gl.UNPACK_SKIP_PIXELS, t.min.x );
    _gl.pixelStorei( _gl.UNPACK_SKIP_ROWS, t.min.y );
    _gl.pixelStorei( _gl.UNPACK_SKIP_IMAGES, t.min.z );
    
    if ( srcTexture.isDataTexture || srcTexture.isData3DTexture ) {
        _gl.texSubImage3D( h, r, e.x, e.y, e.z, s, a, o, l, c, g.data );
    } else {
        _gl.texSubImage3D( h, r, e.x, e.y, e.z, s, a, o, l, c, g );
    }
    
    // Restore original pixelStorei state
    _gl.pixelStorei( _gl.UNPACK_ROW_LENGTH, u );
    _gl.pixelStorei( _gl.UNPACK_IMAGE_HEIGHT, d );
    ...
}
```

---

## GalaxyQUEST-SPEZIFISCHE DATEIEN MIT VOLUMETRISCHEN/VOXEL-EFFEKTEN

### 1. VolumetricScatter.js
**[js/engine/fx/VolumetricScatter.js](js/engine/fx/VolumetricScatter.js)**

- Verwaltet volumetrische Light-Scattering (Phase FX-7)
- Nutzt Shadow-Maps (aber nicht direkt 3D-Texturen für Daten)
- Keine direkten `texImage3D` Aufrufe

### 2. VoxelDebris.js
**[js/engine/fx/VoxelDebris.js](js/engine/fx/VoxelDebris.js)**

- Voxel-Debris Chunk-Pool für Explosionen
- Nutzt geometrische Instanzen (keine 3D-Daten-Texturen)
- Keine direkten `texImage3D` Aufrufe

### 3. MorphTarget-System
**[node_modules/three/src/renderers/webgl/WebGLMorphtargets.js](node_modules/three/src/renderers/webgl/WebGLMorphtargets.js#L75-80)**

```javascript
const texture = new DataArrayTexture( buffer, width, height, morphTargetsCount );
```

Dieses System könnte indirekt 3D-Texturen-Upload-Warnungen generieren.

---

## WARUM KÖNNTEN WARNUNGEN ENTSTEHEN?

### Problem 1: UNPACK_FLIP_Y mit 3D-Texturen
**Ort:** [WebGLTextures.js ~735](node_modules/three/src/renderers/webgl/WebGLTextures.js#L735)

```javascript
_gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );
```

**Kontext:** Obwohl `flipY` auf `false` in Data3DTexture gesetzt ist, kann es sein, dass:
- Ein anderer Code es zu `true` ändert, bevor Upload
- Der WebGL-Kontext nicht unterstützt flip für 3D-Mode
- Chrome/Firefox zeigt Warnung: "INVALID_ENUM in pixelStorei with 3D texture mode"

### Problem 2: UNPACK_PREMULTIPLY_ALPHA mit 3D-Texturen
**Ort:** [WebGLTextures.js ~736](node_modules/three/src/renderers/webgl/WebGLTextures.js#L736)

```javascript
_gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha );
```

**Kontext:** 
- Premultiply Alpha ist für 2D-Canvas/Images gedacht  
- Bei 3D-Daten-Texturen ist dies semantisch nicht sinnvoll
- Kann zu WebGL-Warnungen führen im Renderer-Debug-Modus

### Problem 3: TextureUpload mit pixelStorei Zustand

Der **Haupt-Bug** ist dass der `uploadTexture`-Code **IMMER** pixelStorei setzt:

```javascript
function uploadTexture( textureProperties, texture, slot ) {
    let textureType = _gl.TEXTURE_2D;
    
    if ( texture.isDataArrayTexture || texture.isCompressedArrayTexture ) 
        textureType = _gl.TEXTURE_2D_ARRAY;
    if ( texture.isData3DTexture ) 
        textureType = _gl.TEXTURE_3D;
    
    // ⚠️ BUG: Folgende pixelStorei gelten AUCH für 3D/ARRAY, aber können ungültig sein:
    _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );           // ← Problem
    _gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha ); // ← Problem
    
    if ( texture.isData3DTexture ) {
        state.texImage3D( _gl.TEXTURE_3D, ... );  // Nutzt problematische pixelStorei
    }
}
```

---

## FIX-EMPFEHLUNGEN

### Fix 1: Conditional pixelStorei für 3D-Texturen

**Ort:** [node_modules/three/src/renderers/webgl/WebGLTextures.js ~735-740](node_modules/three/src/renderers/webgl/WebGLTextures.js#L735)

```javascript
// Nur für normale 2D-Texturen pixelStorei FLIP setzen
if ( !texture.isData3DTexture && !texture.isDataArrayTexture ) {
    _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, texture.flipY );
    _gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha );
}

// Alignment und ColorSpace immer gesetzt (neutral für 3D)
_gl.pixelStorei( _gl.UNPACK_ALIGNMENT, texture.unpackAlignment );
_gl.pixelStorei( _gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, unpackConversion );
```

### Fix 2: copyTextureToTexture3D Sicherung

**Ort:** [node_modules/three/src/renderers/WebGLRenderer.js ~2450-2470](node_modules/three/src/renderers/WebGLRenderer.js#L2450)

```javascript
// Vor 3D-Textur-Upload: pixelStorei zurücksetzen
_gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, false );
_gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false );
_gl.pixelStorei( _gl.UNPACK_ALIGNMENT, 1 );

// Dann texSubImage3D aufrufen
_gl.texSubImage3D( ... );
```

---

## DATEI-VOLLSTÄNDIGE ZUSAMMENFASSUNG

| Datei | Zeilen | Funktion | Problem |
|-------|--------|----------|---------|
| [WebGLTextures.js](node_modules/three/src/renderers/webgl/WebGLTextures.js) | 735-736 | uploadTexture pixelStorei | FLIP_Y/PREMULTIPLY_ALPHA bei 3D |
| [WebGLTextures.js](node_modules/three/src/renderers/webgl/WebGLTextures.js) | 1020-1040 | isData3DTexture texImage3D | Warnung nach pixelStorei |
| [WebGLTextures.js](node_modules/three/src/renderers/webgl/WebGLTextures.js) | 1015-1022 | isDataArrayTexture texImage3D | Warnung nach pixelStorei |
| [WebGLTextures.js](node_modules/three/src/renderers/webgl/WebGLTextures.js) | 1365-1375 | RenderTarget 3D texImage3D | Warnung bei Framebuffer-Setup |
| [WebGLRenderer.js](node_modules/three/src/renderers/WebGLRenderer.js) | 2450+ | copyTextureToTexture3D | pixelStorei + texSubImage3D Mix |
| [WebGLState.js](node_modules/three/src/renderers/webgl/WebGLState.js) | 988-1110 | compressedTexImage3D/texImage3D | Error-Handler ohne Context |
| [Data3DTexture.js](node_modules/three/src/textures/Data3DTexture.js) | 10-25 | Klasse-Initialisierung | flipY=false aber nicht *durchgesetzt* |
| [VolumetricScatter.js](js/engine/fx/VolumetricScatter.js) | - | Volumetrische Effekte | Keine 3D-Textur-Nutzung direkt |

---

## WARNUNG-AUSGABE-BEISPIEL

Typische Warnung in der Browser-Konsole:

```
WebGL: INVALID_ENUM in pixelStorei(UNPACK_FLIP_Y_WEBGL, true) 
with TEXTURE_3D bound
[WebGLRenderingContext] 
  at uploadTexture (<anonymous>:735:10)
  at WebGLRenderer.uploadTexture (<minified>)
```

Oder:

```
THREE.WebGLState: DOMException: 
The operation is insecure
  at Function.texImage3D (<minified>)
```

---

## NÄCHSTE SCHRITTSTEUER-EMPFEHLUNG

1. **Verifikation:** Führe Browser-DevTools-Konsole auf an und stelle auf "Show all messages filters" 
2. **Reproduzierung:** Lade eine Scene mit volumetrischer Effekt oder Morphtargets
3. **Lookup:** Suche nach "INVALID_ENUM" oder "INVALID_OPERATION" in Konsole
4. **Patching:** Wende Fix #1 auf lokale three.js an oder aktualisiere auf neuere THREE.js Version (≥r160)

