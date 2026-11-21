export function lineDiff(local:string,remote:string):string {
  const before=local.split(/\r?\n/),after=remote.split(/\r?\n/);
  if(before.length>1000||after.length>1000)return '行数が多いため差分を表示できません。';
  const lengths=Array.from({length:before.length+1},()=>new Uint16Array(after.length+1));
  for(let i=before.length-1;i>=0;i--)
    for(let j=after.length-1;j>=0;j--)
      lengths[i][j]=before[i]===after[j]?1+lengths[i+1][j+1]:Math.max(lengths[i+1][j],lengths[i][j+1]);
  const changes:string[]=[];
  let i=0,j=0;
  while(i<before.length||j<after.length){
    if(i<before.length&&j<after.length&&before[i]===after[j]){i++;j++;continue;}
    if(j===after.length||(i<before.length&&lengths[i+1][j]>=lengths[i][j+1]))
      changes.push('- '+(i+1)+' '+before[i++]);
    else changes.push('+ '+(j+1)+' '+after[j++]);
  }
  const result=changes.join('\n');
  return result.length>12000?result.slice(0,12000)+'\n…（差分の先頭のみ）':result||'行単位の差分はありません。';
}
