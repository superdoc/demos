import {copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function installDemoAnalytics(output,routes){
 await copyFile(new URL('../analytics/demo-analytics.js',import.meta.url),path.join(output,'demo-analytics.js'));
 for(const route of ['',...routes]){const file=path.join(output,route,'index.html'),html=await readFile(file,'utf8');if(!html.includes('src="/demo-analytics.js"'))await writeFile(file,html.replace('</head>','<script defer src="/demo-analytics.js"></script>\n</head>'));}
}
