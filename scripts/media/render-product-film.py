#!/usr/bin/env python3
"""Edit real local Food Hub UI captures and existing restaurant-menu photos.
Silent by design. No AI video, voice, uploads, production access or account writes.
"""
from pathlib import Path
import subprocess, json, os
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(os.environ.get('FOODHUB_FILM_ROOT',REPO/'private/video/product-film'))
OUT=Path(os.environ.get('FOODHUB_FILM_OUTPUT',ROOT/'output')); OUT.mkdir(parents=True,exist_ok=True)
WORK=ROOT/'edit-work'; WORK.mkdir(parents=True,exist_ok=True)
CAP=Path(os.environ.get('FOODHUB_FILM_CAPTURES',REPO/'private/video/reels'))
CAP_EN=Path(os.environ.get('FOODHUB_FILM_CAPTURES_EN',REPO/'private/video/reels-en'))
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
PHOTO=Path(os.environ.get('FOODHUB_FILM_PHOTOS',REPO.parent/'on2goca/public/photos'))
COPY={
 'fr': {
  'eyebrow':'TAKATAK FOOD HUB',
  'intro':['Votre restaurant.','Tout simplement.'],
  'lead':['Les commandes avancent.','Vous gardez le fil.'],
  'kitchen':['De la commande à la cuisine.','Réception, préparation et suivi, dans le même outil.'],
  'orders':['Un service, une vue claire.','Retrouvez la commande et les détails qui comptent.'],
  'wall':['Vos écrans réunis.','Passez de 4 à 8, puis à 16 vues.'],
  'end':['Découvrez Food Hub.','Pensé pour votre service.'],
  'demo':'DÉMONSTRATION LOCALE · DONNÉES FICTIVES',
  'endSub':'Le portail restaurant : foodhub.on2go.ca/hub',
  'brand':'Une solution GROUPE TAKATAK · takatak.ca',
 },
 'en': {
  'eyebrow':'TAKATAK FOOD HUB',
  'intro':['Your restaurant.','Made simpler.'],
  'lead':['Orders keep moving.','You stay in control.'],
  'kitchen':['From order to kitchen.','Receive, prepare and track in the same workspace.'],
  'orders':['A clear view of service.','Find the order and the details that matter.'],
  'wall':['Your screens, together.','Switch from 4 to 8, then 16 views.'],
  'end':['Discover Food Hub.','Built around your service.'],
  'demo':'LOCAL PRODUCT DEMO · FICTIONAL DATA',
  'endSub':'Restaurant portal: foodhub.on2go.ca/hub',
  'brand':'A GROUPE TAKATAK solution · takatak.ca',
 }
}
SCENES=[('intro',4,0,None),('kitchen',8,1.5,'001-kitchen-new-order-15s-landscape.mp4'),('orders',6,0,'003-orders-board-15s-landscape.mp4'),('wall',8,9.5,'002-screens-wall-20s-landscape.mp4'),('end',4,0,None)]
def call(args):
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)
def line(text,name,size,x,y,color='F5F8FC',bold=False):
 f=WORK/(name+'.txt');f.write_text(text)
 return f"drawtext=fontfile={BOLD if bold else FONT}:textfile={f}:fontsize={size}:fontcolor=0x{color}:x={x}:y={y}"
def render_scene(lang,shape,scene,duration,start,src):
 c=COPY[lang];w,h=(1920,1080) if shape=='landscape' else (1080,1080)
 dest=WORK/f'{lang}-{shape}-{scene}.mp4'
 inputs=['-f','lavfi','-i',f'color=c=0x060D1F:s={w}x{h}:r=30:d={duration}']
 vf=[]
 if src:
  inputs+=['-ss',str(start),'-i',str((CAP_EN if lang=='en' else CAP)/src)]
  if shape=='landscape': x,y,sw,sh=120,160,1680,945
  else: x,y,sw,sh=55,335,970,546
  # Entire genuine UI stays visible; a frame distinguishes footage from typography.
  vf += [f'[1:v]scale={sw}:{sh}:flags=lanczos,setsar=1[screen]',f'[0:v][screen]overlay={x}:{y}:shortest=1[base]']
  title,sub=c[scene]
  size=45 if shape=='landscape' else 40
  texts=[line(c['eyebrow'],f'{lang}-{scene}-eyebrow',19,74 if shape=='landscape' else 55,30,'29C3FF',True),line(title,f'{lang}-{scene}-title',size,74 if shape=='landscape' else 55,67 if shape=='landscape' else 105,'F5F8FC',True),line(sub,f'{lang}-{scene}-sub',24 if shape=='landscape' else 23,76 if shape=='landscape' else 55,122 if shape=='landscape' else 185,'B8C4D3')]
  # The landscape video is slightly smaller than its captured size, never a fabricated UI mockup.
  if shape=='landscape':
   vf[0]=f'[1:v]scale=1536:864:flags=lanczos,setsar=1[screen]'
   vf[1]='[0:v][screen]overlay=192:160:shortest=1[base]'
  else:
   texts += [line('FOOD HUB',f'{lang}-{scene}-wordmark',22,55,930,'F5F8FC',True),line('foodhub.on2go.ca',f'{lang}-{scene}-site',22,55,965,'29C3FF')]
 else:
  photo='FYJ5QXV8R7VT2-1200.webp' if scene=='intro' else '597X8A3860936-1200.webp'
  inputs+=['-loop','1','-i',str(PHOTO/photo)]
  if shape=='landscape': x,y,pw,ph=1000,190,820,615
  else:x,y,pw,ph=80,420,920,600
  vf += [f'[1:v]scale={pw*2}:{ph*2}:force_original_aspect_ratio=increase,crop={pw*2}:{ph*2},zoompan=z=1.025+0.00008*on:x=iw/2-iw/zoom/2:y=ih/2-ih/zoom/2:d=1:s={pw}x{ph}:fps=30[photo]',f'[0:v][photo]overlay={x}:{y}:shortest=1[base]']
  title=c['intro'] if scene=='intro' else c['end']
  lx=100 if shape=='landscape' else 55
  top=285 if shape=='landscape' else 125
  fs=67 if shape=='landscape' else 54
  texts=[line(c['eyebrow'],f'{lang}-{scene}-eyebrow',24,lx,115 if shape=='landscape' else 50,'29C3FF',True),line(title[0],f'{lang}-{scene}-title1',fs,lx,top,'F5F8FC',True),line(title[1],f'{lang}-{scene}-title2',fs,lx,top+88 if shape=='landscape' else top+72,'F5F8FC',True)]
  if scene=='intro':
   for i,t in enumerate(c['lead']):texts.append(line(t,f'{lang}-{scene}-lead{i}',29,lx,545+i*48 if shape=='landscape' else 295+i*39,'B8C4D3'))
  else:
   texts += [line('foodhub.on2go.ca/hub',f'{lang}-{scene}-url',37 if shape=='landscape' else 31,lx,540 if shape=='landscape' else 310,'29C3FF',True)]
  if shape=='landscape':texts+=[line('GROUPE TAKATAK · takatak.ca',f'{lang}-{scene}-brand',23,lx,890,'B8C4D3')]
 vf += ['[base]'+','.join(texts+[line(c['demo'],f'{lang}-{scene}-demo',17 if shape=='landscape' else 16,74 if shape=='landscape' else 55,1042,'B8C4D3')])+',format=yuv420p[v]']
 call(inputs+['-filter_complex',';'.join(vf),'-map','[v]','-t',str(duration),'-an','-c:v','libx264','-preset','fast','-crf','19','-threads','4','-r','30','-movflags','+faststart',str(dest)])
 return dest

def srt_time(sec):
 return f'00:00:{sec:02d},000'
results=json.loads((OUT/'manifest.json').read_text()) if (OUT/'manifest.json').exists() else []
for lang in os.environ.get('FOODHUB_FILM_LANGS','fr,en').split(','):
 c=COPY[lang]
 for shape in ['landscape','square']:
  print('Render',lang,shape,flush=True)
  parts=[render_scene(lang,shape,*scene) for scene in SCENES]
  listing=WORK/f'{lang}-{shape}.concat'; listing.write_text(''.join("file '"+str(p)+"'\n" for p in parts))
  dest=OUT/f'foodhub-product-demo-{lang}-{shape}.mp4'
  call(['-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(dest)])
  poster=OUT/(dest.stem+'.jpg');call(['-ss','8','-i',str(dest),'-frames:v','1','-q:v','2',str(poster)])
  results=[r for r in results if not (r['language']==lang and r['shape']==shape)]
  results.append({'file':str(dest.relative_to(OUT)), 'poster':str(poster.relative_to(OUT)), 'language':lang,'shape':shape,'seconds':30,'audio':'silent','provenance':'actual local UI, synthetic records; existing restaurant Clover-menu photo assets; no Runway generation'})
 captions=[(0,4,' · '.join(c['intro'])),(4,12,c['kitchen'][0]),(12,18,c['orders'][0]),(18,26,c['wall'][0]+' '+c['wall'][1]),(26,30,' · '.join(c['end'])+' foodhub.on2go.ca/hub · takatak.ca')]
 srt='\n'.join(f'{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n' for i,(a,b,t) in enumerate(captions,1))
 (OUT/f'foodhub-product-demo-{lang}.srt').write_text(srt)
 (OUT/f'foodhub-product-demo-{lang}.vtt').write_text('WEBVTT\n\n'+'\n'.join(x for x in srt.replace(',000','.000').splitlines() if not x.isdigit())+'\n')
(OUT/'manifest.json').write_text(json.dumps(results,indent=2)+'\n')
print('Rendered',len(results),'films',flush=True)
