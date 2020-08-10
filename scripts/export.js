// author: InMon Corp.
// version: 1.1
// date: 10/19/2019
// description: Prometheus exporter
// copyright: Copyright (c) 2019 InMon Corp. ALL RIGHTS RESERVED

const prefix = getSystemProperty('prometheus.metric.prefix') || 'sflow_';

function fixName(str) {
  return str.replace(/[^a-zA-Z0-9_]/g,'_');
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

var specID = 0;
var userFlows = {};
var SEP = '_SEP_';

function flowSpecName(keys,value,filter,n,t,dropped) {

  if(!keys || !value) return null;

  var key = ''+keys+'#'+value+'#'+filter+'#'+n+'#'+t+'#'+dropped;
  var entry = userFlows[key];
  if(!entry) {
    // try to create flow
    var name = 'prometheus_' + specID;
    try {
      setFlow(name,{keys:keys, value:value, filter: filter, t:t, n:n, fs:SEP, dropped:dropped});
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
  var n = query.n ? query.n[0] : 10;
  var t = query.t ? query.t[0] : 15;
  var filter = query.filter ? query.filter[0] : null;
  var dropped = query.dropped ? "true" === query.dropped[0] : false;
  var aggMode = query.aggMode ? query.aggMode[0] : dropped ? 'sum' : 'max';
  var maxFlows = query.maxFlows ? query.maxFlows[0] : 20;
  var minValue = query.minValue ? query.minValue[0] : 0.1;
  var scale = query.scale ? parseFloat(query.scale[0]) : 1.0;
  
  var spec_name = flowSpecName(keys,value,filter,n,t,dropped);
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
    case 'statistics':
      if(path.length !== 4) throw 'not_found'
      result = getMetric(path[1],path[2],path[3],req.query);
      break;
    case 'flows':
      if(path.length !== 2) throw 'not_found';
      result = getFlows(path[1],req.query);
      break;
    default: throw 'not_found';
  }
  return result;
});
