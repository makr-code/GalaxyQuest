/**
 * Matrix4.js
 *
 * Column-major 4×4 matrix — model/view/projection transforms.
 *
 * Inspired by Three.js Matrix4 (MIT) — https://github.com/mrdoob/three.js
 * and glMatrix (MIT) — https://github.com/toji/gl-matrix
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class Matrix4 {
  constructor() {
    // Column-major, starts as identity
    this.elements = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }

  identity() {
    const e = this.elements;
    e[0]=1; e[4]=0; e[8]=0;  e[12]=0;
    e[1]=0; e[5]=1; e[9]=0;  e[13]=0;
    e[2]=0; e[6]=0; e[10]=1; e[14]=0;
    e[3]=0; e[7]=0; e[11]=0; e[15]=1;
    return this;
  }

  clone() { const m = new Matrix4(); m.elements.set(this.elements); return m; }
  copy(m) { this.elements.set(m.elements); return this; }

  /** this = a × b */
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11=ae[0],a21=ae[1],a31=ae[2],a41=ae[3];
    const a12=ae[4],a22=ae[5],a32=ae[6],a42=ae[7];
    const a13=ae[8],a23=ae[9],a33=ae[10],a43=ae[11];
    const a14=ae[12],a24=ae[13],a34=ae[14],a44=ae[15];
    const b11=be[0],b21=be[1],b31=be[2],b41=be[3];
    const b12=be[4],b22=be[5],b32=be[6],b42=be[7];
    const b13=be[8],b23=be[9],b33=be[10],b43=be[11];
    const b14=be[12],b24=be[13],b34=be[14],b44=be[15];
    te[0]=a11*b11+a12*b21+a13*b31+a14*b41;
    te[1]=a21*b11+a22*b21+a23*b31+a24*b41;
    te[2]=a31*b11+a32*b21+a33*b31+a34*b41;
    te[3]=a41*b11+a42*b21+a43*b31+a44*b41;
    te[4]=a11*b12+a12*b22+a13*b32+a14*b42;
    te[5]=a21*b12+a22*b22+a23*b32+a24*b42;
    te[6]=a31*b12+a32*b22+a33*b32+a34*b42;
    te[7]=a41*b12+a42*b22+a43*b32+a44*b42;
    te[8]=a11*b13+a12*b23+a13*b33+a14*b43;
    te[9]=a21*b13+a22*b23+a23*b33+a24*b43;
    te[10]=a31*b13+a32*b23+a33*b33+a34*b43;
    te[11]=a41*b13+a42*b23+a43*b33+a44*b43;
    te[12]=a11*b14+a12*b24+a13*b34+a14*b44;
    te[13]=a21*b14+a22*b24+a23*b34+a24*b44;
    te[14]=a31*b14+a32*b24+a33*b34+a34*b44;
    te[15]=a41*b14+a42*b24+a43*b34+a44*b44;
    return this;
  }

  multiply(m) { return this.multiplyMatrices(this, m); }

  /** Set from position + quaternion + scale. */
  compose(pos, quat, scale) {
    const e = this.elements;
    const x=quat.x,y=quat.y,z=quat.z,w=quat.w;
    const x2=x+x,y2=y+y,z2=z+z;
    const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2;
    const wx=w*x2,wy=w*y2,wz=w*z2;
    const sx=scale.x,sy=scale.y,sz=scale.z;
    e[0]=(1-(yy+zz))*sx; e[1]=(xy+wz)*sx;     e[2]=(xz-wy)*sx;     e[3]=0;
    e[4]=(xy-wz)*sy;     e[5]=(1-(xx+zz))*sy; e[6]=(yz+wx)*sy;     e[7]=0;
    e[8]=(xz+wy)*sz;     e[9]=(yz-wx)*sz;     e[10]=(1-(xx+yy))*sz;e[11]=0;
    e[12]=pos.x;         e[13]=pos.y;         e[14]=pos.z;         e[15]=1;
    return this;
  }

  makePerspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    const e = this.elements;
    e[0]=f/aspect; e[1]=0; e[2]=0;              e[3]=0;
    e[4]=0;        e[5]=f; e[6]=0;              e[7]=0;
    e[8]=0;        e[9]=0; e[10]=(far+near)*nf; e[11]=-1;
    e[12]=0;       e[13]=0;e[14]=2*far*near*nf; e[15]=0;
    return this;
  }

  makeOrthographic(left, right, top, bottom, near, far) {
    const w=1/(right-left), h=1/(top-bottom), p=1/(far-near);
    const e = this.elements;
    e[0]=2*w; e[1]=0;  e[2]=0;   e[3]=0;
    e[4]=0;   e[5]=2*h;e[6]=0;   e[7]=0;
    e[8]=0;   e[9]=0;  e[10]=-2*p;e[11]=0;
    e[12]=-(right+left)*w; e[13]=-(top+bottom)*h; e[14]=-(far+near)*p; e[15]=1;
    return this;
  }

  /** Returns the Float32Array for direct GPU upload (uniform buffer). */
  toArray() { return this.elements; }

  equals(m) { for (let i=0;i<16;i++) if (this.elements[i]!==m.elements[i]) return false; return true; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Matrix4 };
} else {
  window.GQMatrix4 = Matrix4;
}
