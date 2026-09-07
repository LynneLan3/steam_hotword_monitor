#!/usr/bin/env node
'use strict';
const fs = require('fs');
const https = require('https');
const {execFileSync} = require('child_process');

const SHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';
const RUN_ID = process.env.G010_TARGET_RUN_ID || '20260901-122023';
const OUT = '/tmp/steam_prod_full.xlsx';

async function token() {
  const creds = JSON.parse(fs.readFileSync(process.env.HOME + '/.clasprc.json', 'utf8')).tokens['hotword-ledger'];
  const body = new URLSearchParams({
    client_id: creds.client_id, client_secret: creds.client_secret,
    refresh_token: creds.refresh_token, grant_type: 'refresh_token'
  }).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data).access_token));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function download(access) {
  return new Promise((resolve, reject) => {
    https.get(`https://www.googleapis.com/drive/v3/files/${SHEET_ID}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, {
      headers: {Authorization: 'Bearer ' + access}
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

(async () => {
const access = await token();
fs.writeFileSync(OUT, await download(access));
const report = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, xml.etree.ElementTree as ET, re, json
from collections import Counter, defaultdict
path=${JSON.stringify(OUT)}
run_id=${JSON.stringify(RUN_ID)}
z=zipfile.ZipFile(path)
shared=[]
root=ET.fromstring(z.read('xl/sharedStrings.xml'))
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for si in root.findall('m:si', ns):
    texts=[t.text or '' for t in si.findall('.//m:t', ns)]
    shared.append(''.join(texts))
wb=ET.fromstring(z.read('xl/workbook.xml'))
rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
relmap={r.attrib['Id']: r.attrib['Target'] for r in rels}
RID='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
files={}
for sh in wb.find('m:sheets', ns):
    files[sh.attrib.get('name')]='xl/'+relmap[sh.attrib[RID]].lstrip('/')

def sheet_rows(name):
    root=ET.fromstring(z.read(files[name]))
    rows=defaultdict(dict)
    for c in root.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
        ref=c.attrib.get('r')
        m=re.match(r'([A-Z]+)([0-9]+)', ref)
        col,row=m.group(1), int(m.group(2))
        n=sum((ord(ch)-64)*26**i for i,ch in enumerate(reversed(col)))
        t=c.attrib.get('t')
        v=c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
        if v is None: val=''
        elif t=='s': val=shared[int(v.text)]
        else: val=v.text
        rows[row][n]=val
    return rows

snap=sheet_rows('Steam_每日快照')
by_src=Counter(); pages=Counter(); raw_ids=[]; dup=0; seen=set()
for r in sorted(snap):
    if r==1: continue
    if str(snap[r].get(2,''))!=run_id: continue
    app=str(snap[r].get(3,''))
    src=str(snap[r].get(6,''))
    pg=str(snap[r].get(27,''))
    by_src[src]+=1
    pages[src+'#'+pg]+=1
    raw_ids.append(app)
    if app in seen: dup+=1
    seen.add(app)

log=sheet_rows('运行日志_V2')
logs=[]
for r in sorted(log):
    if r==1: continue
    if str(log[r].get(2,''))==run_id:
        logs.append({
            'status': log[r].get(3,''),
            'raw': log[r].get(4,''),
            'eligible': log[r].get(19,''),
            'enriched': log[r].get(6,''),
            'pass1a': log[r].get(7,''),
            'excluded1a': log[r].get(8,''),
            'trend': log[r].get(9,''),
            'early': log[r].get(10,''),
            'control': log[r].get(11,''),
            'low': log[r].get(12,''),
            'p2Trend': log[r].get(21,''),
            'p2Early': log[r].get(22,''),
            'candidates': log[r].get(4,''),
            'detail': log[r].get(16,'')
        })

master=sheet_rows('候选主表')
mhdr={}
for c,v in master.get(1,{}).items():
    if v: mhdr[str(v).strip()]=c
types=Counter()
for r in sorted(master):
    if r==1: continue
    if str(master[r].get(mhdr.get('最近Run ID',31),''))!=run_id: continue
    types[str(master[r].get(mhdr.get('第一轮类型',21),''))]+=1

cand=sheet_rows('今日候选快照')
cand_n=sum(1 for r in sorted(cand) if r>1 and str(cand[r].get(2,''))==run_id)

print(json.dumps({
    'runId': run_id,
    'rawUnique': len(seen),
    'rawDupRows': dup,
    'bySource': dict(by_src),
    'masterByType': dict(types),
    'masterRows': sum(types.values()),
    'candidateSnapshot': cand_n,
    'finalLog': logs[-1] if logs else None,
    'allLogs': len(logs)
}, ensure_ascii=False))
`], {encoding: 'utf8'}));

console.log(JSON.stringify(report, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
