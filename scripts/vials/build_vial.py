import os
import re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT="/Users/velari/Documents/GitHub/vsresearchlabs"
FDIR=f"{ROOT}/.assets/fonts"
SP=os.path.dirname(os.path.abspath(__file__))
INK=np.array([40,42,50])                 # printed-ink colour (matches label's dark text)
CX=506                                    # label horizontal centre

def cormorant(sz,w=600):
    f=ImageFont.truetype(f"{FDIR}/CormorantGaramond.ttf",sz)
    try:f.set_variation_by_axes([w])
    except:pass
    return f
def mono(sz,semib=False):
    return ImageFont.truetype(f"{FDIR}/IBMPlexMono-{'SemiBold' if semib else 'Medium'}.ttf",sz)

_base=None
def base_plate():
    """Recolour teal->graphite and clear the old Vertex wordmark + name band.
       Returns an RGB image with a clean label ready for the printed lockup."""
    global _base
    if _base is not None: return _base.copy()
    im=Image.open(f"{ROOT}/VILERAW/IMG_2418.PNG").convert("RGB")
    a=np.asarray(im).astype(float); R,G,B=a[:,:,0],a[:,:,1],a[:,:,2]
    mx=a.max(2);mn=a.min(2);df=mx-mn+1e-6;V=mx/255;S=df/(mx+1e-6)
    H=np.zeros_like(mx)
    m=(mx==G);H[m]=60*(2+(B-R)[m]/df[m])
    m=(mx==B);H[m]=60*(4+(R-G)[m]/df[m])
    m=(mx==R);H[m]=60*(((G-B)[m]/df[m])%6); H%=360
    teal=(H>150)&(H<205)&(S>0.18)&(V>0.10)
    L=0.299*R+0.587*G+0.114*B; gray=np.clip((L-40)*1.16+22,0,255)
    a[teal,0]=np.clip(gray[teal]*0.97,0,255);a[teal,1]=np.clip(gray[teal]*0.99,0,255);a[teal,2]=np.clip(gray[teal]*1.03,0,255)
    # clear bands (old wordmark+name, and old PURITY+RUO) with vertical-gradient
    # fills sampled from clean label rows -> matches the label's own shading
    def wipe(x0,x1,y0,y1,sa,sb):
        top=np.median(a[sa-3:sa+3,x0:x1],0); bot=np.median(a[sb-3:sb+3,x0:x1],0)
        for y in range(y0,y1):
            t=(y-y0)/(y1-y0); a[y,x0:x1]=top*(1-t)+bot*t
    wipe(364,648,456,628, 452,636)     # central lockup band
    wipe(380,642,675,726, 670,729)     # PURITY + RUO band (re-rendered smaller)
    _base=Image.fromarray(np.clip(a,0,255).astype('uint8')); return _base.copy()

def wrap(d,text,font,maxw,tr):
    words=text.split(); lines=[]; cur=""
    def w(t): return sum(d.textlength(c,font=font)+tr for c in t)-tr
    for word in words:
        t=(cur+" "+word).strip()
        if w(t)<=maxw or not cur: cur=t
        else: lines.append(cur); cur=word
    lines.append(cur); return lines

def render(compound, out=None):
    base=base_plate()
    cov=Image.new("L", base.size, 0)          # ink-coverage map (white=full ink)
    cd=ImageDraw.Draw(cov)
    maxw=272
    m=re.search(r'\s([\d.]+\s?(?:mg|ml|mcg|iu)[\w./+-]*)$', compound, re.I)
    code=(compound[:m.start()].strip() if m else compound); dose=(m.group(1).strip() if m else "")

    def tw(t,f,tr): return sum(cd.textlength(c,font=f)+tr for c in t)-tr
    def line(t,f,tr,y):
        w=tw(t,f,tr); x=CX-w/2
        for c in t: cd.text((x,y),c,font=f,fill=255); x+=cd.textlength(c,font=f)+tr

    # measure blocks -> centre the whole lockup in the free zone above PURITY
    mark=Image.open(f"{SP}/markv.png").convert("RGBA"); mh=64; mw=int(mark.width*mh/mark.height)
    mark=mark.resize((mw,mh),Image.LANCZOS)
    wf=cormorant(21,600); wtr=3.0
    wh=wf.getmetrics()[0]+wf.getmetrics()[1]
    # compound: SUPER small, mono medium, up to 2 lines
    for csz in range(24,15,-1):
        cf=mono(csz); cls=wrap(cd,code,cf,maxw,1.0)
        if len(cls)<=2 and all(tw(l,cf,1.0)<=maxw for l in cls): break
    ch=cf.getmetrics()[0]+cf.getmetrics()[1]
    dfz=max(13,int(csz*0.62)); dfnt=mono(dfz); dh=dfnt.getmetrics()[0]+dfnt.getmetrics()[1]

    g1,g2,g3=9,17,5                            # gaps: mark|word , word|code , code|dose
    total=mh+g1+wh+g2+ch*len(cls)+(g3+dh if dose else 0)
    y=(452+676)//2 - total//2

    cov.paste(mark.split()[3],(CX-mw//2,y),mark.split()[3]); y+=mh+g1
    line("RESEARCH LABS",wf,wtr,y); y+=wh+g2
    for l in cls: line(l,cf,1.0,y); y+=ch
    if dose: y+=g3; line(dose,dfnt,2.4,y)         # dose just under last code line

    # ---- PURITY + RUO re-rendered LEFT-aligned at one matched small size ----
    lx=392; ruo="RESEARCH USE ONLY / NOT FOR HUMAN USE"; RIGHT=622   # stay inside flat label
    for psz in range(15,8,-1):
        pf=mono(psz)
        if tw(ruo,pf,0.3)<=RIGHT-lx: break
    def leftline(t,f,tr,yy):
        x=lx
        for c in t: cd.text((x,yy),c,font=f,fill=255); x+=cd.textlength(c,font=f)+tr
    ph=pf.getmetrics()[0]+pf.getmetrics()[1]
    leftline("PURITY: 99.9%",pf,0.3,680)
    leftline(ruo,pf,0.3,680+ph+4)

    # ---- composite as PRINTED ink: multiply so label shading shows through ----
    cov=cov.filter(ImageFilter.GaussianBlur(0.5))
    b=np.asarray(base).astype(float); c=np.asarray(cov).astype(float)/255.0
    factor=1-c[:,:,None]*(1-INK/255.0)
    img=Image.fromarray(np.clip(b*factor,0,255).astype('uint8'))
    if out: img.save(out)
    return img

if __name__=="__main__":
    render("AOD-9604 10mg", out=f"{SP}/v_aod.png")
    render("CJC-1295 + Ipamorelin 10mg", out=f"{SP}/v_long.png")
    render("NAD+ 1000mg", out=f"{SP}/v_nad.png")
    print("done")
