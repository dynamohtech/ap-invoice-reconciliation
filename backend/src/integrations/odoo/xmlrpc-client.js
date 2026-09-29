// Minimal XML-RPC client — just enough to call Odoo's external API
// (authenticate + execute_kw), nothing more.
//
// Why this is hand-rolled instead of an npm package: the Node.js XML-RPC
// package ecosystem is thin. The classic `odoo-xmlrpc` package hasn't been
// published since 2019; the actively-published alternatives found while
// building this (`odoo-xmlrpc-ts`, `@tapni/odoo-xmlrpc`) have near-zero
// adoption (0-14 dependents). For a system reconciling real financial
// invoices, depending on a barely-used package felt like the wrong
// trade — XML-RPC itself is a small, stable, 25-year-old protocol, and the
// surface this backend actually needs (call a method, get a value back) is
// about 80 lines. Swap this for a published package later if your team
// prefers; nothing outside this file needs to change if you do (see
// integrations/odoo/client.js — it only calls `xmlrpc.call(...)`).

function encodeValue(value) {
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `<value><int>${value}</int></value>`
      : `<value><double>${value}</double></value>`;
  }
  if (value === null || value === undefined) return `<value><string></string></value>`;
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(encodeValue).join('')}</data></array></value>`;
  }
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .map(([k, v]) => `<member><name>${escapeXml(k)}</name>${encodeValue(v)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${escapeXml(String(value))}</string></value>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildRequest(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params
    .map((p) => `<param>${encodeValue(p)}</param>`)
    .join('')}</params></methodCall>`;
}

// A small hand-rolled parser, not a general XML parser: it walks <value>
// nodes and only understands the tags XML-RPC itself defines. This is
// deliberately just enough to decode what Odoo actually sends back
// (structs, arrays, strings, ints, doubles, booleans) — good enough for the
// two calls this backend makes, not a general-purpose XML-RPC library.
function parseValue(node) {
  const tagMatch = node.match(/^<(\w+)>([\s\S]*)<\/\1>$/);
  if (!tagMatch) return node.trim(); // bare string value (XML-RPC allows omitting <string>)
  const [, tag, inner] = tagMatch;
  switch (tag) {
    case 'string': return unescapeXml(inner);
    case 'int':
    case 'i4': return parseInt(inner, 10);
    case 'double': return parseFloat(inner);
    case 'boolean': return inner.trim() === '1';
    case 'array': {
      const dataMatch = inner.match(/<data>([\s\S]*)<\/data>/);
      return splitTopLevel(dataMatch ? dataMatch[1] : '', 'value').map(parseValue);
    }
    case 'struct': {
      const obj = {};
      for (const memberXml of splitTopLevel(inner, 'member')) {
        const nameMatch = memberXml.match(/<name>([\s\S]*?)<\/name>/);
        const valueMatch = memberXml.match(/<value>([\s\S]*)<\/value>/);
        if (nameMatch && valueMatch) obj[unescapeXml(nameMatch[1])] = parseValue(valueMatch[1]);
      }
      return obj;
    }
    default: return inner;
  }
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Splits a string into the top-level occurrences of <tag>...</tag>,
// respecting nesting (so a <struct> inside an <array>'s <value> isn't cut
// in the wrong place).
function splitTopLevel(xml, tag) {
  const results = [];
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let depth = 0;
  let start = -1;
  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith(openTag, i)) {
      if (depth === 0) start = i;
      depth++;
      i += openTag.length;
    } else if (xml.startsWith(closeTag, i)) {
      depth--;
      i += closeTag.length;
      if (depth === 0) results.push(xml.slice(start + openTag.length, i - closeTag.length));
    } else {
      i++;
    }
  }
  return results;
}

function parseResponse(xml) {
  if (xml.includes('<fault>')) {
    const faultValue = xml.match(/<fault>\s*<value>([\s\S]*)<\/value>\s*<\/fault>/)[1];
    const fault = parseValue(faultValue);
    throw new Error(`Odoo XML-RPC fault: ${fault.faultString || JSON.stringify(fault)}`);
  }
  const paramMatch = xml.match(/<params>\s*<param>\s*<value>([\s\S]*)<\/value>\s*<\/param>\s*<\/params>/);
  if (!paramMatch) return null;
  return parseValue(paramMatch[1]);
}

async function call(url, method, params) {
  const body = buildRequest(method, params);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body,
  });
  if (!res.ok) throw new Error(`XML-RPC HTTP error ${res.status} calling ${method} at ${url}`);
  const text = await res.text();
  return parseResponse(text);
}

export default { call };
