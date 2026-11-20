import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
export async function localD1(filename=':memory:'){
 const sql=new DatabaseSync(filename);sql.exec('CREATE TABLE IF NOT EXISTS local_migrations (id TEXT PRIMARY KEY)');
 const journal=JSON.parse(await fs.readFile('drizzle/meta/_journal.json','utf8'));
 for(const entry of journal.entries){if(!sql.prepare('SELECT id FROM local_migrations WHERE id=?').get(entry.tag)){sql.exec(await fs.readFile('drizzle/'+entry.tag+'.sql','utf8'));sql.prepare('INSERT INTO local_migrations VALUES(?)').run(entry.tag);}}
 function statement(query,values=[]){return {bind(...args){return statement(query,args);},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values),success:true,meta:{changes:0}};},async run(){const r=sql.prepare(query).run(...values);return {results:[],success:true,meta:{changes:Number(r.changes)}};},query,values};}
 return {prepare:statement,async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements){if(/^\s*SELECT/i.test(s.query))results.push(await s.all());else results.push(await s.run());}sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}
