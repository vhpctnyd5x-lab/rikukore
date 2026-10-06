"""使い方: python3 tools/make_faces.py（リポジトリの根で）
立ち絵から顔の位置を探し、顔を真ん中にした正方形の切り抜きを作る（assets/faces/）。
肌色の画素のうち一番上の塊を顔とみなす。帽子・髪の下にある。手作業の補正は FIX に書く。"""
import glob, json, sys
from PIL import Image
import numpy as np
FIX={"bt7": {"cx": 262, "cy": 100, "fw": 78}, "is2": {"cx": 298, "cy": 90, "fw": 70}, "m26": {"cx": 243, "cy": 78, "fw": 66}, "tiger2": {"cx": 205, "cy": 65, "fw": 62}, "tiger2_d1": {"cx": 170, "cy": 62, "fw": 60}, "tiger2_d2": {"cx": 210, "cy": 58, "fw": 60}, "tiger2_d3": {"cx": 200, "cy": 72, "fw": 62}, "panther_d2": {"cx": 150, "cy": 48, "fw": 52}, "panther_d3": {"cx": 188, "cy": 58, "fw": 52}, "tiger1_d2": {"cx": 186, "cy": 85, "fw": 64}, "tiger1_d3": {"cx": 190, "cy": 85, "fw": 64}, "m4a1": {"cx": 160, "cy": 115, "fw": 70}}
out={}
import os
os.makedirs('assets/faces/wide',exist_ok=True)
files=sorted(f for f in glob.glob('assets/characters/*.png') if not f.endswith('_d4.png'))
for f in files:
    key=f.split('/')[-1][:-4]
    im=Image.open(f).convert('RGBA'); a=np.asarray(im).astype(int)
    R,G,B,A=a[...,0],a[...,1],a[...,2],a[...,3]
    skin=(A>200)&(R>190)&(G>140)&(B>110)&(R>G)&(G>B)&(R-B>28)&(R-B<110)&(G-B>8)
    H,W=skin.shape
    rows=skin.sum(1)
    thr=max(6,W*0.03)
    ys=np.where(rows>thr)[0]
    y0=int(ys[0]) if len(ys) else H//8
    band=skin[y0:y0+int(H*0.11)]
    yy,xx=np.nonzero(band)
    cx=float(np.median(xx)) if len(xx) else W/2
    fw=float(np.percentile(xx,95)-np.percentile(xx,5)) if len(xx) else W*0.25
    fw=max(fw,H*0.07)
    cy=y0+fw*0.45
    if key in FIX: cx,cy,fw=[FIX[key].get(k,v) for k,v in (('cx',cx),('cy',cy),('fw',fw))]
    s=int(fw*2.3); x0=int(cx-s/2); y1=int(cy-s/2)
    crop=im.crop((x0,y1,x0+s,y1+s)).resize((192,192),Image.LANCZOS)
    crop.save(f'assets/faces/{key}.webp',quality=86,method=6)
    # 編成の札の横長の帯（目から口が真ん中に来る 2.4:1）
    bw,bh=fw*2.9,fw*1.2; bx=int(cx-bw/2); by=int(cy+fw*0.2-bh/2)
    im.crop((bx,by,bx+int(bw),by+int(bh))).resize((300,124),Image.LANCZOS).save(f'assets/faces/wide/{key}.webp',quality=86,method=6)
    out[key]=dict(cx=round(cx),cy=round(cy),fw=round(fw),W=W,H=H)
print(len(out),'faces')
