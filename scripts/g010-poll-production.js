#!/usr/bin/env node
/** Poll production spreadsheet export for G010 run completion. */
'use strict';

const fs = require('fs');
const https = require('https');
const {execFileSync} = require('child_process');

const SHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';
const RUN_ID = process.env.G010_TARGET_RUN_ID || '20260901-110846';
const OUT = '/tmp/steam_prod_full.xlsx';

function token() {
  const creds = JSON.parse(fs.readFileSync(process.env.HOME + '/.clasprc.json', 'utf8')).tokens['hotword-ledger'];
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token'
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

function download(access) {
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

function parse() {
  return JSON.parse(execFileSync('python3', ['-c', `
import zipfile, xml.etree.ElementTree as ET, re, json, sys
from collections import defaultdict
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

log=sheet_rows('运行日志_V2')
log_rows=[]
for r in sorted(log):
    if r==1: continue
    if str(log[r].get(2,''))==run_id:
        log_rows.append({'r': r, 'status': log[r].get(3, ''), 'raw': log[r].get(4, ''), 'enriched': log[r].get(6, ''), 'pass1a': log[r].get(7, ''), 'detail': log[r].get(16, '')})
snap=sheet_rows('Steam_每日快照')
raw=set()
for r in sorted(snap):
    if r==1: continue
    if str(snap[r].get(2,''))==run_id:
        raw.add(str(snap[r].get(3,'')))
master=sheet_rows('候选主表')
mhdr={}
for c,v in master.get(1,{}).items():
    if v: mhdr[str(v).strip()]=c
run_col=mhdr.get('最近Run ID', 31)
mcount=0
for r in sorted(master):
    if r==1: continue
    if str(master[r].get(run_col,''))==run_id: mcount+=1
cand=sheet_rows('今日候选快照')
cc=0
for r in sorted(cand):
    if r==1: continue
    if str(cand[r].get(2,''))==run_id: cc+=1
print(json.dumps({'runId':run_id,'log':log_rows[-3:],'rawUnique':len(raw),'masterRows':mcount,'candidateSnapshot':cc}))
`], {encoding: 'utf8'}));
}

(async () => {
  const access = await token();
  fs.writeFileSync(OUT, await download(access));
  const report = parse();
  console.log(JSON.stringify({at: new Date().toISOString(), ...report}, null, 2));
  const last = (report.log || []).slice(-1)[0];
  process.exit(last && String(last.status).toUpperCase() === 'SUCCESS' ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
