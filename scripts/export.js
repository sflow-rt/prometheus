function prometheusMetric(val) {
  if('number' !== typeof val.metricValue) return null;

  var result =  val.metricName.replace(/[^a-zA-Z0-9:_]/g,'_');
  result += '{agent="'+val.agent+'",datasource="'+val.dataSource+'"';
  var host = metric(val.agent,'2.1.host_name')[0].metricValue;
  if(!host) {
    let nnames = topologyNodesForAgent(val.agent);
    host = nnames && names.length === 1 ? nnames[0] : null; 
  }
  if(host != null) result += ',host="'+host+'"';
  if(val.dataSource.indexOf('.') === -1) {
    let ifname = ifName(val.agent,val.dataSource);
    if(ifname) result += ',ifname="'+ifname+'"';
  } else if(val.dataSource.startsWith('3.')) {
    let vir_host = metric(val.agent,val.dataSource+'.vir_host_name')[0].metricValue;
    if(vir_host) result += ',vir_host="'+vir_host+'"';
  }
  result += '} ' + val.metricValue;
  return result;
}

function getDump(agents,names,filter) {
  var i, val, result = [], vals = dump(agents,names,filter);
  for(i = 0; i < vals.length; i++) {
    val = prometheusMetric(vals[i]);
    if(!val) continue;
    result.push(val);
  }
  return result.join('\n');
}

setHttpHandler(function(req) {
  var result, path = req.path;
  if(!path || path.length === 0) throw 'not_found';
  switch(path[0]) {
    case 'dump':
      if(path.length !== 3) throw 'not_found';
      result = getDump(path[1],path[2],req.query);
      break;
    default: throw 'not_found';
  }
  return result;
});
