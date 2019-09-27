function prometheusMetric(val) {
  if('number' !== typeof val.metricValue) return null;

  var result =  val.metricName.replace(/[^a-zA-Z0-9:_]/g,'_');
  result += '{agent="'+val.agent+'",datasource="'+val.dataSource+'"';
  var host = metric(val.agent,'2.1.host_name')[0].metricValue;
  if(!host) {
    let nnames = topologyNodesForAgent(val.agent);
    host = nnames && nnames.length === 1 ? nnames[0] : null; 
  }
  if(host != null) result += ',host="'+host+'"';
  if(val.dataSource.indexOf('.') === -1) {
    let ifname = ifName(val.agent,val.dataSource);
    if(ifname) result += ',ifname="'+ifname+'"';
  } else if(val.dataSource.startsWith('3.')) {
    let vir_host = metric(val.agent,val.dataSource+'.vir_host_name')[0].metricValue;
    if(vir_host) {
      if(vir_host.startsWith('k8s_')) {
        // Parse Kubernetes dockershim name
        // https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/dockershim/naming.go
        if(vir_host.startsWith('k8s_POD_')) {
          // Sandbox
          // k8s_POD_{s.name}_{s.namespace}_{s.uid}_{s.attempt}
          return null;
        } else {
          // Container
          // k8s_{c.name}_{s.name}_{s.namespace}_{s.uid}_{c.attempt}
          let [,name,,namespace] = vir_host.split('_');
          if(name) result += ',k8s_name="'+name+'"';
          if(namespace) result += ',k8s_namespace="'+namespace+'"';
        }
      } else {
        // Check for Docker Swarm mode name
        let swarm = vir_host.match(/^([^\.]+)\.([^\.]{25})\.([^\.]{25})$/);
        if(swarm) {
          result += ',swarm_name="'+swarm[1]+'"'; 
        } else {
          result += ',vir_host="'+vir_host+'"';
        }
      }
    }
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
