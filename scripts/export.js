// author: InMon Corp.
// version: 1.0
// date: 10/8/2019
// description: Prometheus exporter
// copyright: Copyright (c) 2019 InMon Corp. ALL RIGHTS RESERVED

const prefix = getSystemProperty('prometheus.prefix') || 'sflow_';

function fixName(str) {
  return str.replace(/[^a-zA-Z0-9_]/g,'_');
}

function getAnalyzer() {
  var res = analyzer();

  var result = prefix+'rt_uptime_ms '+res.uptime+'\n';
  result += prefix+'rt_agents '+res.sFlowAgents+'\n';
  result += prefix+'rt_datagrams_received '+res.sFlowDatagramsReceived+'\n';
  result += prefix+'rt_bytes_received '+res.sFlowBytesReceived+'\n';
  result += prefix+'rt_parse_errors '+res.sFlowParseErrors+'\n';
  result += prefix+'rt_unsupported_version '+res.sFlowUnsupportedVersion+'\n';
  result += prefix+'rt_datagrams_discarded '+res.sFlowDatagramsDiscarded+'\n';
  result += prefix+'rt_http_connections_current '+res.httpConnectionsCurrent+'\n';
  result += prefix+'rt_http_connections_total '+res.httpConnectionsTotal+'\n';
  result += prefix+'rt_http_messages_sent '+res.httpBytesSent+'\n';
  result += prefix+'rt_http_messages_received '+res.httpMessagesReceived+'\n';
  result += prefix+'rt_http_bytes_sent '+res.httpBytesSent+'\n';
  result += prefix+'rt_http_bytes_received '+res.httpBytesReceived+'\n';
  result += prefix+'rt_available_processors '+res.availableProcessors+'\n';
  result += prefix+'rt_heap_max '+res.heapMax+'\n';
  result += prefix+'rt_heap_used '+res.heapUsed+'\n';
  result += prefix+'rt_thread_total_started '+res.threadTotalStartedCount+'\n';
  result += prefix+'rt_thread_count '+res.threadCount+'\n';
  result += prefix+'rt_thread_daemon_count '+res.threadDaemonCount+'\n';
  result += prefix+'rt_gc_time_ms '+res.gcTime+'\n';
  result += prefix+'rt_gc_count '+res.gcCount+'\n';
  result += prefix+'rt_flows_generated '+res.flowsGenerated+'\n';
  result += prefix+'rt_events_generated '+res.eventsGenerated+'\n';
  if(res.hasOwnProperty('cpuTime')) result += prefix+'rt_cpu_time_ms '+res.cpuTime+'\n';
  if(res.hasOwnProperty('memTotal')) result += prefix+'rt_mem_total '+res.memTotal+'\n';
  if(res.hasOwnProperty('memFree')) result += prefix+'rt_mem_free '+res.memFree+'\n';
  if(res.hasOwnProperty('cpuLoadSystem')) result += prefix+'rt_cpu_load_system '+res.cpuLoadSystem+'\n';
  if(res.hasOwnProperty('cpuLoadProcess')) result += prefix+'rt_cpu_load_process '+res.cpuLoadProcess+'\n';

  return result;
}

function getMetric(group,agents,names,filter) {
  var i, result = [], vals = metric(agents,names,filter);
  if(!vals) return null;

  for(i = 0; i < vals.length; i++) {
    let val = vals[i];
    if('number' !== typeof val.metricValue) continue;

    let rec = prefix+fixName(val.metricName)+'{group="'+group+'"} '+val.metricValue+'\n';
    result.push(rec); 
  }
  return result.join('');
}

function prometheusMetric(val) {

  // ignore flow metrics
  if(val.topKeys) return null;

  // ignore string metrics
  if('number' !== typeof val.metricValue) return null;

  var result =  prefix+fixName(val.metricName);
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
  result += '} ' + val.metricValue + '\n';
  return result;
}

function getDump(agents,names,filter) {
  var i, val, result = [], vals = dump(agents,names,filter);
  for(i = 0; i < vals.length; i++) {
    val = prometheusMetric(vals[i]);
    if(!val) continue;
    result.push(val);
  }
  return result.join('');
}

var specID = 0;
var userFlows = {};
var SEP = '_SEP_';

function flowSpecName(keys,value,filter,n,t) {

  if(!keys || !value) return null;

  var key = ''+keys+'#'+value+'#'+filter+'#'+n+'#'+t;
  var entry = userFlows[key];
  if(!entry) {
    // try to create flow
    var name = 'prometheus_' + specID;
    try {
      setFlow(name,{keys:keys, value:value, filter: filter, t:t, n:n, fs:SEP});
      entry = {name:name};
      userFlows[key] = entry;
      specID++;
    } catch(e) {
      logInfo(e);
      entry = null;
    }
  }
  if(!entry) return null;
  entry.lastQuery = Date.now();

  return entry.name;
}

function deleteUserFlows(now) {
  var key, entry;
  for(key in userFlows) {
    entry = userFlows[key];
    if(now - entry.lastQuery > 300000) {
      clearFlow(entry.name);
      delete userFlows[key];
    }
  }
}

setIntervalHandler(function(now) {
  deleteUserFlows(now);
});

function prometheusFlow(metric,keynames,flow,scale) {
  var i, result = fixName(metric), keys = flow.key.split(SEP);
  result += '{';
  for(i = 0; i < keys.length; i++) {
    if(i > 0) result += ',';
    result += fixName(keynames[i]) + '="'+keys[i]+'"';
  }
  result += '} ' + (flow.value * scale) + '\n';
  return result;
}

function getFlows(agents,query) {
  if(!query.metric) throw 'bad_request';

  var metric = query.metric[0];
  var labels = query.label ? query.label.join(',') : null;
  var keys = query.key ? query.key.join(',') : null;
  var value = query.value ? query.value[0] : null;
  var filter = query.filter ? query.filter.join('&') : null;
  var n = query.n ? query.n[0] : 10;
  var t = query.t ? query.t[0] : 15;
  var filter = query.filter ? query.filter[0] : null;
  var aggMode = query.aggMode ? query.aggMode[0] : 'max';
  var maxFlows = query.maxFlows ? query.maxFlows[0] : 20;
  var minValue = query.minValue ? query.minValue[0] : 0.1;
  var scale = query.scale ? parseFloat(query.scale[0]) : 1.0;
  
  var spec_name = flowSpecName(keys,value,filter,n,t);
  if(!spec_name) throw 'bad_request';

  var i, keynames = keys.split(',');
  if(labels) {
    labels = labels.split(',');
    for(i = 0; i < keynames.length; i++) {
      if(labels[i] && labels[i].length) keynames[i] = labels[i];
    }
  }

  var result = [];
  var flows = activeFlows(agents,spec_name,maxFlows,minValue,aggMode);
  for(i = 0; i < flows.length; i++) {
    result.push(prometheusFlow(metric,keynames,flows[i],scale));
  }
  return result.join(''); 
}

setHttpHandler(function(req) {
  var result, path = req.path;
  if(!path || path.length === 0) throw 'not_found';
  switch(path[0]) {
    case 'analyzer':
      if(path.length !== 1) throw 'now_found';
      result = getAnalyzer();
      break;
    case 'statistics':
      if(path.length !== 4) throw 'not_found'
      result = getMetric(path[1],path[2],path[3],req.query);
      break;
    case 'dump':
      if(path.length !== 3) throw 'not_found';
      result = getDump(path[1],path[2],req.query);
      break;
    case 'flows':
      if(path.length !== 2) throw 'not_found';
      result = getFlows(path[1],req.query);
      break;
    default: throw 'not_found';
  }
  return result;
});
