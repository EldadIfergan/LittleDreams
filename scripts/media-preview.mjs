import http from 'node:http';
import {readFileSync} from 'node:fs';
const pages={'/':'test/media-browser.html','/media.js':'public/media.js','/vendor/mediabunny.mjs':'public/vendor/mediabunny.mjs'};
http.createServer((req,res)=>{const path=pages[req.url];if(!path){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(readFileSync(path));}).listen(3012,'127.0.0.1');
