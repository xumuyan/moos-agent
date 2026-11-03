// Shared by the mobile page and Node tests. This endpoint never accepts agent tasks.
export function localOrigin(value) {
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::([0-9]+))?\/?$/.exec(value.trim());
  if (match == null) throw new Error('填写 Mac 的局域网地址，例如 http://mac-name.local:43101');
  const host = match[2].toLowerCase();
  const octets = host.split('.').map(Number);
  const ipv4 = octets.length === 4 && host === octets.join('.') && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateIp = ipv4 && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const localName = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.local$/.test(host);
  if (!privateIp && !localName) throw new Error('仅允许私有局域网 IP 或 Mac 的 .local 主机名');
  const port = match[3] == null ? null : Number(match[3]);
  if (port != null && (port < 1 || port > 65535)) throw new Error('端口必须在 1 到 65535 之间');
  return match[1] + '://' + host + (port == null ? '' : ':' + port);
}

export function verifyHealth(status, body, probeId) {
  if (status !== 200 || body == null || body.service !== 'moos-m01-health'
      || body.probeId !== probeId || body.protocolVersion !== 1) {
    throw new Error('收到的响应不匹配本次 Mac 健康检查');
  }
  return '已收到 Mac 的健康检查响应；尚未验证配对、事件通道或桌面任务。';
}
