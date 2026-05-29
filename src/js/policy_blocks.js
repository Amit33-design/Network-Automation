'use strict';

/* ════════════════════════════════════════════════════════════════
   NETDESIGN AI — Policy Block Generator
   ─────────────────────────────────────────────────────────────
   Generates deterministic policy config blocks that are appended
   to every device config.  Each of the 9 policy domains checks:
     1. Is the toggle enabled?  (STATE.include_*)
     2. Does this device role use this policy?
     3. Which OS syntax to emit?

   Entry point:
     buildPolicyBlocks(dev, os)  → string (appended to raw config)

   Called by generateConfig() in configgen.js after the base
   device stanza is generated.
════════════════════════════════════════════════════════════════ */

/* ── Role helpers ───────────────────────────────────────────── */
function _roles(dev) {
  const l  = dev.layer || '';
  const uc = STATE.uc   || 'campus';
  return {
    isAccess:  l === 'campus-access',
    isDist:    l === 'campus-dist',
    isCore:    l === 'campus-core',
    isSpine:   l === 'dc-spine' || l === 'gpu-spine',
    isLeaf:    l === 'dc-leaf',
    isTOR:     l === 'gpu-tor',
    isFW:      l === 'fw',
    isGPU:     uc === 'gpu',
    isDC:      uc === 'dc' || uc === 'hybrid' || uc === 'multisite',
    isCampus:  uc === 'campus' || uc === 'hybrid',
    isWAN:     uc === 'wan',
    isL3:      l === 'campus-core' || l === 'campus-dist' || l === 'dc-spine' || l === 'dc-leaf',
    hasWifi:   (STATE.nac||[]).some(n=>/wireless/i.test(n)) ||
               (STATE.protoFeatures||[]).some(f=>/wireless/i.test(f)),
    hasDot1x:  (STATE.nac||[]).some(n=>/802\.1x|dot1x|nac/i.test(n)),
    hasBGP:    (STATE.underlayProto||[]).includes('BGP') || uc==='dc' || uc==='gpu',
    hasPFC:    (STATE.gpuSpecifics||[]).some(g=>/pfc/i.test(g)) || uc==='gpu',
    hasVXLAN:  (STATE.overlayProto||[]).some(o=>/vxlan/i.test(o)),
    hasVoice:  (STATE.appTypes||[]).some(a=>/voice|phone|ucm/i.test(a)),
    hasIoT:    (STATE.appTypes||[]).some(a=>/iot|bms|ot|scada/i.test(a)),
  };
}

/* ── Toggle check helpers ───────────────────────────────────── */
function _inc(key) {
  // Default true (all enabled) if STATE key not set
  const v = STATE[key];
  return v === undefined ? true : v !== false;
}

/* ════════════════════════════════════════════════════════════
   MASTER ENTRY POINT
════════════════════════════════════════════════════════════ */
function buildPolicyBlocks(dev, os) {
  if (!dev) return '';
  const R = _roles(dev);
  const parts = [];

  const add = (fn) => { try { const s = fn(dev, os, R); if (s) parts.push(s.trim()); } catch(_){} };

  if (_inc('include_aaa'))             add(_polAAA);
  if (_inc('include_bgp_policy'))      add(_polBGP);
  if (_inc('include_acl'))             add(_polACL);
  if (_inc('include_dot1x'))           add(_polDot1x);
  if (_inc('include_qos'))             add(_polQoS);
  if (_inc('include_vlan_policy'))     add(_polVLAN);
  if (_inc('include_static_routing'))  add(_polStatic);
  if (_inc('include_trunk_policy'))    add(_polTrunk);
  if (_inc('include_wireless'))        add(_polWireless);

  if (!parts.length) return '';
  const sep = os === 'sonic' ? '\n# ' : (os === 'junos' ? '\n/* ' : '\n! ');
  const hdr = os === 'sonic'
    ? '\n# ════════════════════════════════════════════════════\n# POLICY BLOCKS — appended by NetDesign AI\n# ════════════════════════════════════════════════════'
    : os === 'junos'
    ? '\n/* ═══════════════════════════════════════════════════\n   POLICY BLOCKS — appended by NetDesign AI\n   ═══════════════════════════════════════════════════ */'
    : '\n! ═══════════════════════════════════════════════════\n! POLICY BLOCKS — appended by NetDesign AI\n! ═══════════════════════════════════════════════════';

  return hdr + '\n' + parts.join('\n!\n') + '\n';
}

/* ════════════════════════════════════════════════════════════
   1. AAA / MANAGEMENT
   Applies: all devices
   TACACS+, SNMPv3, syslog, NTP auth, SSH hardening, banner
════════════════════════════════════════════════════════════ */
function _polAAA(dev, os, R) {
  const name = dev.name;

  if (os === 'ios-xe') return `
! ── AAA / Management Security ───────────────────────────────
aaa new-model
aaa authentication login default group tacacs+ local
aaa authentication enable default group tacacs+ enable
aaa authorization exec default group tacacs+ local if-authenticated
aaa authorization commands 15 default group tacacs+ local
aaa accounting exec default start-stop group tacacs+
aaa accounting commands 15 default start-stop group tacacs+
!
tacacs server TACACS-PRIMARY
 address ipv4 10.0.0.50
 key 7 NetDesign@TACACS!
 timeout 5
!
tacacs server TACACS-SECONDARY
 address ipv4 10.0.0.51
 key 7 NetDesign@TACACS!
 timeout 5
!
! ── SNMPv3 (no community strings) ──────────────────────────
snmp-server view MGMT-VIEW iso included
snmp-server group NETDESIGN-GROUP v3 priv write MGMT-VIEW
snmp-server user NETDESIGN-USER NETDESIGN-GROUP v3 auth sha256 NetDesign@Auth#2026 priv aes 256 NetDesign@Priv#2026
snmp-server host 10.0.0.200 version 3 priv NETDESIGN-USER
snmp-server enable traps bgp
snmp-server enable traps entity
snmp-server chassis-id ${name}
!
! ── NTP with authentication ─────────────────────────────────
ntp authenticate
ntp authentication-key 1 md5 NTPsecret@2026
ntp trusted-key 1
ntp server 10.0.0.1 key 1 prefer version 4
ntp server 10.0.0.2 key 1 version 4
clock timezone UTC 0
!
! ── Syslog ──────────────────────────────────────────────────
logging buffered 131072 informational
logging trap informational
logging host 10.0.0.200 transport udp port 514
logging source-interface Loopback0
logging facility local7
logging userinfo
logging on
!
! ── SSH v2 hardening ────────────────────────────────────────
ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
ip ssh source-interface Loopback0
ip ssh dh-min-size 2048
ip ssh server algorithm encryption aes256-ctr aes192-ctr aes128-ctr
ip ssh server algorithm mac hmac-sha2-512 hmac-sha2-256
no ip ssh server algorithm mac hmac-sha1
!
! ── VTY hardening ───────────────────────────────────────────
line vty 0 15
 login authentication default
 transport input ssh
 exec-timeout 15 0
 session-timeout 30
 logging synchronous
line con 0
 exec-timeout 10 0
 logging synchronous
!
! ── MOTD Banner ─────────────────────────────────────────────
banner motd ^
*************************************************************
* ${name} — AUTHORISED ACCESS ONLY                         *
* All activity is monitored and logged. Disconnect NOW if  *
* you are not an authorised NetDesign administrator.       *
*************************************************************
^`;

  if (os === 'nxos') return `
! ── AAA / Management ────────────────────────────────────────
feature tacacs+
!
tacacs-server host 10.0.0.50 key NetDesign@TACACS! timeout 5
tacacs-server host 10.0.0.51 key NetDesign@TACACS! timeout 5
!
aaa group server tacacs+ TACACS-GROUP
  server 10.0.0.50
  server 10.0.0.51
  use-vrf management
!
aaa authentication login default group TACACS-GROUP local
aaa authentication login console local
aaa authorization commands default group TACACS-GROUP local
aaa accounting default group TACACS-GROUP
!
! ── SNMPv3 ──────────────────────────────────────────────────
snmp-server user NETDESIGN-USER network-admin auth sha NetDesign@Auth#2026 priv aes-256 NetDesign@Priv#2026
snmp-server host 10.0.0.200 traps version 3 priv NETDESIGN-USER
snmp-server enable traps bgp
snmp-server chassis-id ${name}
!
! ── NTP ─────────────────────────────────────────────────────
ntp authenticate
ntp authentication-key 1 md5 NTPsecret@2026
ntp trusted-key 1
ntp server 10.0.0.1 key 1 use-vrf management prefer
ntp server 10.0.0.2 key 1 use-vrf management
clock timezone UTC 0 0
!
! ── Syslog ──────────────────────────────────────────────────
logging server 10.0.0.200 6 use-vrf management facility local7
logging source-interface loopback0
logging timestamp milliseconds
logging level bgp 5
logging level ospf 5
!
! ── SSH v2 ──────────────────────────────────────────────────
ssh key rsa 4096
feature ssh
no feature telnet
ip ssh source-interface loopback0
!
line vty
 session-limit 8
 exec-timeout 15 0
 transport input ssh
banner motd # AUTHORISED ACCESS ONLY — ${name} — All sessions logged #`;

  if (os === 'eos') return `
! ── AAA / Management ────────────────────────────────────────
aaa authentication login default group tacacs+ local
aaa authentication enable default group tacacs+ local
aaa authorization exec default group tacacs+ local
aaa accounting commands all default start-stop group tacacs+
!
tacacs-server host 10.0.0.50
   key 0 NetDesign@TACACS!
   timeout 5
   vrf MGMT
!
tacacs-server host 10.0.0.51
   key 0 NetDesign@TACACS!
   timeout 5
   vrf MGMT
!
aaa group server tacacs+ TACACS-GROUP
   server 10.0.0.50
   server 10.0.0.51
   local interface Loopback0
   vrf MGMT
!
! ── SNMPv3 ──────────────────────────────────────────────────
snmp-server group NETDESIGN-GROUP v3 priv
snmp-server user NETDESIGN-USER NETDESIGN-GROUP v3 auth sha512 NetDesign@Auth#2026 priv aes256 NetDesign@Priv#2026 localized key
snmp-server host 10.0.0.200 vrf MGMT version 3 priv NETDESIGN-USER
snmp-server enable traps bgp
snmp-server chassis-id ${name}
!
! ── NTP (authenticated) ─────────────────────────────────────
ntp authenticate
ntp authentication-key 1 sha1 NTPsecret@2026
ntp trusted-key 1
ntp server vrf MGMT 10.0.0.1 key 1 prefer
ntp server vrf MGMT 10.0.0.2 key 1
!
! ── Syslog ──────────────────────────────────────────────────
logging vrf MGMT host 10.0.0.200
logging facility local7
logging level BGP informational
logging level EVPN informational
logging on
!
! ── SSH v2 / Management hardening ───────────────────────────
management ssh
   idle-timeout 15
   authentication-retries 3
   rekey-period 3600
   transport output ssh
   no shutdown
!
management telnet
   shutdown
!
banner login
 AUTHORISED ACCESS ONLY — ${name} — All sessions are monitored.
EOF`;

  if (os === 'junos') return `
system {
    /* ── AAA / Management ───────────────────────────────── */
    authentication-order [ tacacs+ password ];
    tacplus-server {
        10.0.0.50 { secret "NetDesign@TACACS!"; timeout 5; }
        10.0.0.51 { secret "NetDesign@TACACS!"; timeout 5; }
    }
    accounting {
        events [ login interactive-commands ];
        destination {
            tacplus {
                server { 10.0.0.50 { secret "NetDesign@TACACS!"; } }
            }
        }
    }
    ntp {
        authentication-key 1 type md5 value "NTPsecret@2026";
        trusted-key 1;
        server 10.0.0.1 key 1 prefer;
        server 10.0.0.2 key 1;
    }
    syslog {
        host 10.0.0.200 { any info; }
        file messages { any notice; }
        source-address 0.0.0.0;
    }
    services {
        ssh { protocol-version v2; max-sessions-per-connection 4; }
        telnet { /* DISABLED */ }
    }
    login {
        message "AUTHORISED ACCESS ONLY — ${name}";
    }
}
snmp {
    v3 {
        usm {
            local-engine {
                user NETDESIGN-USER {
                    authentication-sha512 { authentication-password "NetDesign@Auth#2026"; }
                    privacy-aes256 { privacy-password "NetDesign@Priv#2026"; }
                }
            }
        }
    }
}`;

  if (os === 'sonic') return `
# ── AAA / Management (SONiC config_db.json snippets) ────────
{
  "TACPLUS_SERVER": {
    "10.0.0.50": { "priority": 1, "tcp_port": 49, "timeout": 5 },
    "10.0.0.51": { "priority": 2, "tcp_port": 49, "timeout": 5 }
  },
  "TACPLUS": { "global": { "auth_type": "pap", "passkey": "NetDesign@TACACS!" } },
  "AAA": {
    "authentication": { "login": "tacacs+,local" },
    "authorization":  { "login": "tacacs+,local" },
    "accounting":     { "login": "tacacs+,local" }
  },
  "NTP_SERVER": { "10.0.0.1": { "prefer": "true" }, "10.0.0.2": {} },
  "SYSLOG_SERVER": { "10.0.0.200": { "source": "lo" } },
  "SNMP_COMMUNITY": { "NETDESIGN-RO": { "TYPE": "RO" } }
}`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   2. BGP POLICIES
   Applies: core, dist, spine, leaf, TOR (L3 devices)
   Route-maps, prefix-lists, communities, AS-path
════════════════════════════════════════════════════════════ */
function _polBGP(dev, os, R) {
  if (!R.isL3 && !R.isCore && !R.isDist && !R.isFW) return '';
  if (!R.hasBGP && !R.isCampus) return '';

  const asn = STATE.bgp_asn || (R.isDC ? '65000' : '65100');

  if (os === 'ios-xe') return `
! ── BGP Policies (Route-maps · Prefix-lists · Communities) ──
ip prefix-list PL-DEFAULT     seq 5 permit 0.0.0.0/0
ip prefix-list PL-RFC1918     seq 5 permit 10.0.0.0/8 le 32
ip prefix-list PL-RFC1918     seq 10 permit 172.16.0.0/12 le 32
ip prefix-list PL-RFC1918     seq 15 permit 192.168.0.0/16 le 32
ip prefix-list PL-LOOPBACKS   seq 5 permit 10.255.0.0/16 le 32
ip prefix-list PL-DENY-ALL    seq 5 deny 0.0.0.0/0 le 32
!
ip community-list standard COMM-INTERNAL   permit ${asn}:100
ip community-list standard COMM-NO-EXPORT  permit ${asn}:200
ip community-list standard COMM-BLACKHOLE  permit ${asn}:9999
!
ip as-path access-list 1 permit ^$
ip as-path access-list 2 permit ^${asn}_
!
route-map RM-EXPORT-TO-WAN permit 10
 description Export corporate prefixes to WAN / ISP
 match ip address prefix-list PL-RFC1918
 set community ${asn}:100 additive
route-map RM-EXPORT-TO-WAN deny 20
!
route-map RM-IMPORT-FROM-WAN permit 10
 description Accept default route from ISP
 match ip address prefix-list PL-DEFAULT
 set local-preference 200
 set community ${asn}:100 additive
route-map RM-IMPORT-FROM-WAN deny 20
!
route-map RM-INTERNAL-ONLY permit 10
 match community COMM-INTERNAL
route-map RM-INTERNAL-ONLY deny 20
!
route-map RM-BLACKHOLE permit 10
 description Null0 blackhole for security
 match community COMM-BLACKHOLE
 set ip next-hop 192.0.2.1
!
! ── BGP max-prefix safety ───────────────────────────────────
! Applied per-neighbor: maximum-prefix 50000 warning-only`;

  if (os === 'nxos') return `
! ── BGP Policies ────────────────────────────────────────────
ip prefix-list PL-DEFAULT seq 5 permit 0.0.0.0/0
ip prefix-list PL-LOOPBACKS seq 5 permit 10.255.0.0/16 le 32
ip prefix-list PL-RFC1918 seq 5 permit 10.0.0.0/8 le 32
ip prefix-list PL-RFC1918 seq 10 permit 172.16.0.0/12 le 32
ip prefix-list PL-DENY-ALL seq 5 deny 0.0.0.0/0 le 32
!
ip community-list standard COMM-INTERNAL permit ${asn}:100
ip community-list standard COMM-NO-EXPORT permit no-export
!
route-map RM-CONNECTED-TO-BGP permit 10
  match ip address prefix-list PL-LOOPBACKS
  set community ${asn}:100 additive
route-map RM-CONNECTED-TO-BGP deny 20
!
route-map RM-FROM-SPINE permit 10
  set local-preference 200
route-map RM-FROM-SPINE permit 20
!
route-map RM-TO-SPINE permit 10
  match ip address prefix-list PL-LOOPBACKS
  set community ${asn}:100 additive
route-map RM-TO-SPINE deny 20`;

  if (os === 'eos') return `
! ── BGP Policies ────────────────────────────────────────────
ip prefix-list PL-LOOPBACKS    seq 5  permit 10.255.0.0/16 le 32
ip prefix-list PL-VTEP-ANYCAST seq 5  permit 10.1.0.0/16   le 32
ip prefix-list PL-DEFAULT      seq 5  permit 0.0.0.0/0
ip prefix-list PL-RFC1918      seq 5  permit 10.0.0.0/8     le 32
ip prefix-list PL-RFC1918      seq 10 permit 172.16.0.0/12  le 32
ip prefix-list PL-DENY-ALL     seq 5  deny   0.0.0.0/0      le 32
!
ip community-list standard COMM-INTERNAL permit ${asn}:100
ip community-list standard COMM-NO-EXPORT permit ${asn}:200
!
route-map RM-VTEP-TO-SPINE permit 10
   match ip address prefix-list PL-LOOPBACKS
   set community ${asn}:100 additive
route-map RM-VTEP-TO-SPINE permit 20
   match ip address prefix-list PL-VTEP-ANYCAST
   set community ${asn}:100 additive
route-map RM-VTEP-TO-SPINE deny 30
!
route-map RM-SPINE-TO-VTEP permit 10
   set local-preference 200
route-map RM-SPINE-TO-VTEP permit 20
!
route-map RM-NO-EXPORT deny 10
   match community COMM-NO-EXPORT
route-map RM-NO-EXPORT permit 20`;

  if (os === 'junos') return `
policy-options {
    prefix-list PL-LOOPBACKS  { 10.255.0.0/16; }
    prefix-list PL-DEFAULT    { 0.0.0.0/0; }
    prefix-list PL-RFC1918    { 10.0.0.0/8; 172.16.0.0/12; 192.168.0.0/16; }
    community COMM-INTERNAL   members ${asn}:100;
    community COMM-NO-EXPORT  members no-export;
    policy-statement RM-EXPORT-LOOPBACKS {
        term match-loopbacks {
            from { prefix-list PL-LOOPBACKS; }
            then { community add COMM-INTERNAL; accept; }
        }
        term deny-rest { then reject; }
    }
    policy-statement RM-IMPORT-FROM-PEER {
        term match-default {
            from { prefix-list PL-DEFAULT; }
            then { local-preference 200; accept; }
        }
        term deny-rest { then reject; }
    }
}`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   3. INFRASTRUCTURE ACL (iACL)
   Applies: all devices — protect management plane
   VTY ACL, anti-spoofing, CoPP, management ACLs
════════════════════════════════════════════════════════════ */
function _polACL(dev, os, R) {
  if (os === 'ios-xe') return `
! ── Infrastructure ACL (iACL) ───────────────────────────────
ip access-list extended ACL-VTY-ACCESS
 10 permit tcp 10.0.0.0 0.0.0.255 any eq 22
 20 permit tcp 10.100.0.0 0.1.255.255 any eq 22
 30 deny tcp any any eq 22 log
 40 deny tcp any any eq 23 log
 50 permit ip any any
!
ip access-list extended ACL-MGMT-IN
 10 remark Allow ICMP from management subnet
 10 permit icmp 10.0.0.0 0.0.0.255 any
 20 permit udp 10.0.0.0 0.0.0.255 any eq snmp
 30 permit udp any any eq ntp
 40 permit tcp 10.0.0.0 0.0.0.255 any eq 22
 50 deny ip any any log
!
ip access-list extended ACL-ANTI-SPOOF
 10 deny ip 10.0.0.0 0.255.255.255 any log
 20 deny ip 172.16.0.0 0.15.255.255 any log
 30 deny ip 192.168.0.0 0.0.255.255 any log
 40 deny ip 127.0.0.0 0.255.255.255 any log
 50 deny ip 0.0.0.0 0.255.255.255 any log
 60 deny ip 255.0.0.0 0.255.255.255 any log
 70 permit ip any any
!
! Apply VTY ACL
line vty 0 15
 access-class ACL-VTY-ACCESS in vrf-also
!
! ── Control Plane Policing (CoPP) ───────────────────────────
class-map match-any CoPP-CRITICAL
 match access-group name ACL-VTY-ACCESS
class-map match-any CoPP-MANAGEMENT
 match access-group name ACL-MGMT-IN
!
policy-map PM-CoPP
 class CoPP-CRITICAL
  police rate 128000 bps burst 1000000 byte conform-action transmit exceed-action drop
 class CoPP-MANAGEMENT
  police rate 64000 bps burst 500000 byte conform-action transmit exceed-action drop
 class class-default
  police rate 8000 bps burst 64000 byte conform-action transmit exceed-action drop
!
control-plane
 service-policy input PM-CoPP`;

  if (os === 'nxos') return `
! ── Infrastructure ACL (iACL / CoPP) ───────────────────────
ip access-list ACL-VTY-ACCESS
  10 permit tcp 10.0.0.0/24 any eq 22
  20 permit tcp 10.100.0.0/23 any eq 22
  30 deny tcp any any eq 22 log
  40 deny tcp any any eq 23 log
  50 permit ip any any
!
ip access-list ACL-MGMT-IN
  10 permit icmp 10.0.0.0/24 any
  20 permit udp 10.0.0.0/24 any eq snmp
  30 permit udp any any eq ntp
  40 permit tcp 10.0.0.0/24 any eq 22
  50 deny ip any any log
!
ip access-list ACL-ANTI-SPOOF
  10 deny ip 10.0.0.0/8 any log
  20 deny ip 172.16.0.0/12 any log
  30 deny ip 192.168.0.0/16 any log
  40 deny ip 127.0.0.0/8 any log
  50 deny ip 0.0.0.0/8 any log
  60 permit ip any any
!
line vty
 access-class ACL-VTY-ACCESS in
!
! ── CoPP (Control Plane Policing) ───────────────────────────
copp copy profile strict
copp profile strict`;

  if (os === 'eos') return `
! ── Infrastructure ACL (iACL) ───────────────────────────────
ip access-list ACL-VTY-ACCESS
   10 permit tcp 10.0.0.0/24 any eq ssh
   20 permit tcp 10.100.0.0/23 any eq ssh
   30 deny tcp any any eq ssh log
   40 deny tcp any any eq telnet log
   50 permit ip any any
!
ip access-list ACL-MGMT-IN
   10 permit icmp 10.0.0.0/24 any
   20 permit udp any any eq ntp
   30 permit tcp 10.0.0.0/24 any eq ssh
   40 deny ip any any log
!
management security
   password encryption-key NetDesign@EncKey#2026
!
management ssh
   access-group ACL-VTY-ACCESS
!
system control-plane
   ip access-group ACL-MGMT-IN in`;

  if (os === 'junos') return `
firewall {
    family inet {
        filter PROTECT-RE {
            term ALLOW-SSH { from { source-address { 10.0.0.0/24; } protocol tcp; destination-port 22; } then accept; }
            term ALLOW-ICMP { from { protocol icmp; } then accept; }
            term ALLOW-BGP  { from { protocol tcp; destination-port 179; } then accept; }
            term ALLOW-NTP  { from { protocol udp; destination-port 123; } then accept; }
            term ALLOW-SNMP { from { source-address { 10.0.0.0/24; } protocol udp; destination-port 161; } then accept; }
            term DENY-ALL   { then { discard; log; syslog; } }
        }
    }
}
routing-options {
    forwarding-table { export ECMP-POLICY; }
}
interfaces { lo0 { unit 0 { family inet { filter { input PROTECT-RE; } } } } }`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   4. 802.1X / NAC (IBNS 2.0)
   Applies: campus-access only
   IBNS 2.0, MAB fallback, Guest VLAN, CoA, RADIUS
════════════════════════════════════════════════════════════ */
function _polDot1x(dev, os, R) {
  if (!R.isAccess) return '';
  if (!R.hasDot1x && !R.isCampus) return '';

  if (os === 'ios-xe') return `
! ── 802.1X / NAC — IBNS 2.0 ────────────────────────────────
aaa new-model
aaa authentication dot1x default group ISE-CLUSTER local
aaa authorization network default group ISE-CLUSTER
aaa accounting dot1x default start-stop group ISE-CLUSTER
aaa accounting network default start-stop group ISE-CLUSTER
!
radius server ISE-PRIMARY
 address ipv4 10.0.0.50 auth-port 1812 acct-port 1813
 key NetDesign@RADIUS!
 automate-tester username probe-user probe-on
radius server ISE-SECONDARY
 address ipv4 10.0.0.51 auth-port 1812 acct-port 1813
 key NetDesign@RADIUS!
!
aaa group server radius ISE-CLUSTER
 server name ISE-PRIMARY
 server name ISE-SECONDARY
 load-balance method least-outstanding
 deadtime 5
!
! ── IBNS 2.0 Policy Map ─────────────────────────────────────
class-map type control subscriber match-all CM-DOT1X-FAILED
 match authorization-status unauthorized
 match method dot1x
class-map type control subscriber match-all CM-MAB-FAILED
 match authorization-status unauthorized
 match method mab
class-map type control subscriber match-all CM-DOT1X-TIMEOUT
 match method dot1x
 match result-type method dot1x agent-not-found
class-map type control subscriber match-any CM-AAA-SVR-DOWN
 match result-type aaa-timeout
!
policy-map type control subscriber PM-DOT1X-IBNS20
 event session-started match-all
  10 class always do-until-failure
   10 authenticate using dot1x retries 2 retry-time 0 priority 10
 event authentication-failure match-first
  5 class CM-DOT1X-TIMEOUT do-until-failure
   10 authenticate using mab priority 20
  10 class CM-DOT1X-FAILED do-until-failure
   10 authenticate using mab priority 20
  20 class CM-MAB-FAILED do-until-failure
   10 authorize
   20 pause reauthenticate
 event agent-found match-all
  10 class always do-until-failure
   10 authenticate using dot1x retries 2 retry-time 0 priority 10
 event aaa-available match-all
  10 class CM-AAA-SVR-DOWN do-until-failure
   10 clear-authenticated-data-hosts-on-port
   20 authenticate using dot1x priority 10
!
! ── Apply 802.1X to access ports (template) ─────────────────
dot1x system-auth-control
dot1x critical eapol
!
template DOT1X-ACCESS-PORT
 dot1x pae authenticator
 dot1x timeout tx-period 10
 dot1x timeout quiet-period 60
 mab
 subscriber aging inactivity-timer 60 probe
 source template DOT1X-ACCESS-PORT
 service-policy type control subscriber PM-DOT1X-IBNS20
 switchport access vlan 20
 switchport mode access
 switchport voice vlan 30
 spanning-tree portfast
 spanning-tree bpduguard enable
 ip dhcp snooping limit rate 15
 ip arp inspection limit rate 100
 storm-control broadcast level 10 5
 storm-control multicast level 15 10
 no shutdown
!
! ── Guest VLAN & Critical VLAN ──────────────────────────────
authentication event fail action next-method
authentication event no-response action authorize vlan 21
authentication event server-dead action authorize vlan 20
authentication event server-alive action reinitialize
!
! ── Change of Authorization (CoA) ───────────────────────────
aaa server radius dynamic-author
 client 10.0.0.50 server-key NetDesign@RADIUS!
 client 10.0.0.51 server-key NetDesign@RADIUS!
 auth-type all
 port 3799`;

  if (os === 'nxos') return `
! ── 802.1X / MAB (NX-OS) ───────────────────────────────────
feature dot1x
!
radius-server host 10.0.0.50 key NetDesign@RADIUS! authentication accounting
radius-server host 10.0.0.51 key NetDesign@RADIUS! authentication accounting
radius-server retransmit 2
radius-server timeout 5
!
aaa group server radius ISE-CLUSTER
  server 10.0.0.50
  server 10.0.0.51
  use-vrf management
!
aaa authentication dot1x default group ISE-CLUSTER
aaa authorization network default group ISE-CLUSTER
!
dot1x system-auth-control
!
! Apply to access interfaces (example on Ethernet1/1):
! interface Ethernet1/1
!  dot1x port-control auto
!  dot1x host-mode multi-auth
!  mab
!  spanning-tree port type edge
!  spanning-tree bpduguard enable`;

  if (os === 'eos') return `
! ── 802.1X / NAC (Arista EOS) ───────────────────────────────
dot1x system-auth-control
!
radius-server host 10.0.0.50 auth-port 1812 acct-port 1813 key 0 NetDesign@RADIUS! vrf MGMT
radius-server host 10.0.0.51 auth-port 1812 acct-port 1813 key 0 NetDesign@RADIUS! vrf MGMT
!
aaa group server radius ISE-CLUSTER
   server 10.0.0.50
   server 10.0.0.51
!
aaa authentication dot1x default group ISE-CLUSTER local
aaa authorization network default group ISE-CLUSTER local
!
! Access interface template (apply per port):
! interface Ethernet1–48
!    dot1x port-control auto
!    dot1x host-mode multi-host
!    dot1x reauthentication
!    dot1x timeout reauth-period 3600
!    switchport access vlan 20
!    switchport voice vlan 30
!    spanning-tree portfast
!    spanning-tree bpduguard enable`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   5. QoS POLICY
   Applies: all (campus 8-class, GPU PFC/ECN, WAN CBWFQ)
════════════════════════════════════════════════════════════ */
function _polQoS(dev, os, R) {

  if (os === 'ios-xe') {
    if (R.isGPU) return `
! ── QoS — GPU / RoCEv2 (PFC + ECN, IOS-XE) ─────────────────
! PFC on priority 3 (RoCEv2 / RDMA traffic)
interface range GigabitEthernet1/0/1-48
 priority-flow-control mode on
 priority-flow-control priority 3 no-drop
 service-policy type qos input PM-RDMA-CLASSIFY
!
class-map match-any CM-RDMA
 match dscp 26 28 34 36 46
class-map match-any CM-STORAGE
 match dscp 18 20
class-map match-any CM-MGMT
 match dscp 16
!
policy-map PM-RDMA-CLASSIFY
 class CM-RDMA
  set dscp 26
 class CM-STORAGE
  set dscp 18
 class class-default
  set dscp default
!
policy-map PM-RDMA-EGRESS
 class CM-RDMA
  priority percent 80
 class CM-STORAGE
  bandwidth percent 15
 class class-default
  bandwidth percent 5`;

    return `
! ── QoS — 8-class Campus (DSCP-based, IOS-XE) ───────────────
class-map match-any CM-VOICE
 match dscp ef cs5
class-map match-any CM-INTERACTIVE-VIDEO
 match dscp af41 af42 cs4
class-map match-any CM-CALL-SIGNALING
 match dscp cs3 af31
class-map match-any CM-CRITICAL-DATA
 match dscp af21 af22 cs2
class-map match-any CM-BULK-DATA
 match dscp af11 af12
class-map match-any CM-SCAVENGER
 match dscp cs1
class-map match-any CM-NETWORK-CTRL
 match dscp cs6 cs7
class-map match-any CM-DEFAULT
 match dscp default
!
policy-map PM-CAMPUS-EGRESS
 class CM-VOICE
  priority percent 30
  police rate percent 30
 class CM-INTERACTIVE-VIDEO
  bandwidth percent 20
 class CM-CALL-SIGNALING
  bandwidth percent 5
 class CM-CRITICAL-DATA
  bandwidth percent 20
 class CM-BULK-DATA
  bandwidth percent 10
 class CM-SCAVENGER
  bandwidth percent 1
 class CM-NETWORK-CTRL
  bandwidth percent 4
 class class-default
  bandwidth percent 10
  fair-queue
!
policy-map PM-CAMPUS-INGRESS-MARK
 class CM-VOICE
  set dscp ef
 class CM-INTERACTIVE-VIDEO
  set dscp af41
 class class-default
  set dscp default
!
! Apply QoS on uplink interfaces
interface range GigabitEthernet0/1-2
 service-policy output PM-CAMPUS-EGRESS
 service-policy input PM-CAMPUS-INGRESS-MARK
mls qos
mls qos map cos-dscp 0 8 16 24 32 46 48 56`;
  }

  if (os === 'nxos') return `
! ── QoS — NX-OS (8-class DSCP, PFC for GPU) ────────────────
class-map type qos match-any CM-RDMA
  match dscp 26 28 34 36
class-map type qos match-any CM-VOICE
  match dscp 46
class-map type qos match-any CM-VIDEO
  match dscp 34 32
class-map type qos match-any CM-CRITICAL
  match dscp 26 24
class-map type qos match-any CM-BULK
  match dscp 10 12
class-map type qos match-any CM-SCAVENGER
  match dscp 8
class-map type queuing CM-PFC-PAUSE
  match qos-group 2
!
policy-map type qos PM-INGRESS-CLASSIFY
  class CM-RDMA
    set qos-group 2
  class CM-VOICE
    set qos-group 6
  class CM-CRITICAL
    set qos-group 4
  class class-default
    set qos-group 0
!
policy-map type queuing PM-EGRESS-QUEUING
  class type queuing CM-PFC-PAUSE
    bandwidth percent 60
    pause buffer-size 300
  class type queuing class-fcoe
    bandwidth percent 10
  class type queuing class-all-flood
    bandwidth percent 2
  class type queuing class-default
    bandwidth percent 28
!
policy-map type network-qos PM-PFC-LOSSLESS
  class type network-qos CM-PFC-PAUSE
    pause no-drop
    mtu 9216
  class type network-qos class-fcoe
    pause no-drop
    mtu 2158
  class type network-qos class-default
    mtu 9216
!
system qos
  service-policy type qos input PM-INGRESS-CLASSIFY
  service-policy type queuing input PM-EGRESS-QUEUING
  service-policy type network-qos PM-PFC-LOSSLESS
${R.hasPFC ? `!
! PFC lossless (GPU/RDMA)
interface Ethernet1/1 - 1/32
  priority-flow-control mode on
  priority-flow-control priority 3 no-drop` : ''}`;

  if (os === 'eos') return `
! ── QoS — Arista EOS (DSCP + PFC for GPU) ──────────────────
qos map dscp-to-traffic-class
   dscp 46       traffic-class 7   ! Voice EF
   dscp 34 36    traffic-class 5   ! Video AF41/42
   dscp 26 28    traffic-class 4   ! RDMA / RoCEv2
   dscp 24       traffic-class 3   ! Call signaling CS3
   dscp 16 18    traffic-class 2   ! Critical AF21
   dscp 8 10     traffic-class 1   ! Bulk
   dscp 0        traffic-class 0   ! Default BE
!
qos map traffic-class-to-dscp
   traffic-class 7 dscp 46
   traffic-class 5 dscp 34
   traffic-class 4 dscp 26
   traffic-class 3 dscp 24
   traffic-class 2 dscp 18
   traffic-class 1 dscp 10
   traffic-class 0 dscp 0
!
policy-map type qos PM-CAMPUS-MARK
   class CM-VOICE
      set dscp ef
   class CM-RDMA
      set dscp 26
   class class-default
      set dscp default
${R.hasPFC ? `!
! PFC Lossless for RoCEv2/RDMA (GPU fabric)
priority-flow-control mode on
priority-flow-control priority 3 no-drop
!
! ECN (DCQCN) — 150KB min, 1.5MB max
queue-monitor length notifying
queue-monitor length global-buffer threshold 25 percent` : ''}`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   6. VLAN POLICY
   Applies: campus access, dist, core; DC leaf
   VLAN DB, STP priorities, VACLs, PVLAN, SVIs
════════════════════════════════════════════════════════════ */
function _polVLAN(dev, os, R) {
  if (!R.isAccess && !R.isDist && !R.isCore && !R.isLeaf) return '';

  if (os === 'ios-xe') return `
! ── VLAN Policy (STP · VACLs · Pruning) ─────────────────────
! STP tuning
spanning-tree mode rapid-pvst
spanning-tree loopguard default
spanning-tree portfast bpduguard default
${R.isCore ? 'spanning-tree vlan 1-4094 priority 4096' :
  R.isDist  ? 'spanning-tree vlan 1-4094 priority 8192' :
              'spanning-tree vlan 1-4094 priority 32768'}
!
! STP timers (campus optimised)
spanning-tree vlan 10,20,30,40,50 hello-time 2
spanning-tree vlan 10,20,30,40,50 max-age 20
spanning-tree vlan 10,20,30,40,50 forward-time 15
!
! VACL — deny intra-VLAN routing to sensitive subnets
ip access-list extended ACL-CORP-PERMIT
 10 permit ip 10.10.0.0 0.0.3.255 any
 20 deny ip any 10.0.0.0 0.255.255.255 log
 30 permit ip any any
!
vlan access-map VAM-CORP 10
 action forward
 match ip address ACL-CORP-PERMIT
vlan filter VAM-CORP vlan-list 20-21
!
! DHCP Snooping (binding database)
ip dhcp snooping
ip dhcp snooping vlan 10,20,21,30,40,41,50
no ip dhcp snooping information option
ip dhcp snooping database flash:dhcp-snooping.db
!
! ARP Inspection
ip arp inspection vlan 20,21,30,40,41,50
ip arp inspection validate src-mac dst-mac ip
!
! 802.1Q VTP
vtp mode transparent
vtp domain NETDESIGN-VTP
vtp password NetDesign@VTP!`;

  if (os === 'nxos') return `
! ── VLAN Policy (STP · DHCP Snoop · ARP Inspect) ───────────
spanning-tree mode rapid-pvst
spanning-tree loopguard default
spanning-tree portfast bpduguard default
${R.isSpine ? 'spanning-tree vlan 1-3967 priority 4096' :
  R.isLeaf  ? 'spanning-tree vlan 1-3967 priority 8192' :
              'spanning-tree vlan 1-3967 priority 32768'}
!
ip dhcp snooping
ip dhcp snooping vlan 10,20,21,30,40,41,50,100-110
no ip dhcp snooping information option
ip dhcp snooping verify mac-address
!
ip arp inspection vlan 20-21,30,40-41
ip arp inspection validate src-mac dst-mac ip
!
feature private-vlan
vtp mode off`;

  if (os === 'eos') return `
! ── VLAN Policy (STP · DHCP · ARP) ─────────────────────────
spanning-tree mode rapid-pvst
spanning-tree loopguard default
${R.isSpine || R.isCore ? 'spanning-tree vlan-id 1-4094 priority 4096' :
  R.isLeaf  || R.isDist ? 'spanning-tree vlan-id 1-4094 priority 8192' :
                          'spanning-tree vlan-id 1-4094 priority 32768'}
!
ip dhcp snooping
ip dhcp snooping vlan 10,20,21,30,40,41,50
no ip dhcp snooping information option
!
ip arp inspection vlan 20,21,30,40,41
ip arp inspection validate src-mac dst-mac ip`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   7. STATIC ROUTING
   Applies: FW, core, dist (fallback/gateway)
   Default routes, floating statics, Null0, IP SLA
════════════════════════════════════════════════════════════ */
function _polStatic(dev, os, R) {
  if (!R.isFW && !R.isCore && !R.isDist) return '';

  if (os === 'ios-xe') return `
! ── Static Routing — Default · Null0 · IP SLA ───────────────
! Primary default route with IP SLA tracking
ip sla 10
 icmp-echo 8.8.8.8 source-ip 10.0.0.1
 frequency 10
 timeout 5000
ip sla schedule 10 life forever start-time now
!
track 10 ip sla 10 reachability
!
! Default via primary ISP (tracked)
ip route 0.0.0.0 0.0.0.0 ${R.isFW ? '203.0.113.1' : '10.0.0.1'} 10 track 10
!
! Floating static — secondary ISP (higher AD)
ip route 0.0.0.0 0.0.0.0 ${R.isFW ? '198.51.100.1' : '10.0.0.2'} 20
!
! Aggregate discard (Null0 — prevents routing loops)
ip route 10.0.0.0 255.0.0.0 Null0 254
ip route 10.10.0.0 255.255.252.0 Null0 254
ip route 10.20.0.0 255.255.254.0 Null0 254
ip route 10.30.0.0 255.255.252.0 Null0 254
!
! Management route (always reachable)
ip route 10.0.0.0 255.255.255.0 ${R.isFW ? '10.0.0.10' : '10.0.0.1'} 5`;

  if (os === 'nxos') return `
! ── Static Routing ──────────────────────────────────────────
ip route 0.0.0.0/0 10.0.0.1 10
ip route 0.0.0.0/0 10.0.0.2 20
ip route 10.0.0.0/8 Null0 254
ip route 10.10.0.0/22 Null0 254`;

  if (os === 'eos') return `
! ── Static Routing ──────────────────────────────────────────
ip route 0.0.0.0/0 10.0.0.1 10
ip route 0.0.0.0/0 10.0.0.2 20
ip route 10.0.0.0/8 Null0 254
ip route 10.10.0.0/22 Null0 254`;

  if (os === 'junos') return `
routing-options {
    static {
        route 0.0.0.0/0 next-hop 10.0.0.1;
        route 10.0.0.0/8 discard preference 254;
    }
}`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   8. TRUNK / UPLINKS
   Applies: dist, core, leaf, spine — inter-switch links
   LACP port-channels, allowed VLANs, storm control, UDLD
════════════════════════════════════════════════════════════ */
function _polTrunk(dev, os, R) {
  if (R.isAccess || R.isFW) return '';   // access + FW get inline, not here

  if (os === 'ios-xe') return `
! ── Trunk / Uplink Policy ───────────────────────────────────
! Port-channel (LACP active) — apply to uplink pairs
interface Port-channel1
 description UPLINK-TO-CORE/SPINE
 switchport trunk encapsulation dot1q
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50,60,99
 spanning-tree guard root
 spanning-tree bpduguard enable
 udld aggressive
 storm-control broadcast level 10 5
 storm-control multicast level 15 10
 storm-control action shutdown
 ip dhcp snooping trust
 ip arp inspection trust
 no shutdown
!
interface range GigabitEthernet1/1/1-2
 description UPLINK-LACP-MEMBER
 channel-group 1 mode active
 lacp port-priority 100
 spanning-tree portfast trunk
 udld aggressive
 no shutdown
!
! Global LACP/CDP/LLDP
lacp system-priority 100
cdp run
lldp run`;

  if (os === 'nxos') return `
! ── Trunk / LACP Uplinks ────────────────────────────────────
feature lacp
feature lldp
!
interface port-channel1
 description UPLINK-TO-SPINE
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40-41,50,60,99
 spanning-tree guard root
 udld aggressive
 storm-control broadcast level 10
 storm-control multicast level 15
 storm-control action shutdown
 ip dhcp snooping trust
 no shutdown
!
interface Ethernet1/1
 description LACP-UPLINK-MEMBER-1
 channel-group 1 mode active
 no shutdown
interface Ethernet1/2
 description LACP-UPLINK-MEMBER-2
 channel-group 1 mode active
 no shutdown
!
system jumbomtu 9216
lacp system-priority 100`;

  if (os === 'eos') return `
! ── Trunk / LACP Uplinks ────────────────────────────────────
interface Port-Channel1
   description UPLINK-TO-SPINE
   switchport mode trunk
   switchport trunk native vlan 99
   switchport trunk allowed vlan 10,20,21,30,40-41,50,60,99
   spanning-tree guard root
   storm-control broadcast level 10
   storm-control multicast level 15
   udld aggressive
   no shutdown
!
interface Ethernet49/1
   description LACP-UPLINK-1
   channel-group 1 mode active
   no shutdown
interface Ethernet50/1
   description LACP-UPLINK-2
   channel-group 1 mode active
   no shutdown
!
lacp system-priority 100
spanning-tree portfast bpduguard default`;

  if (os === 'junos') return `
interfaces {
    ae0 {
        description "LACP-UPLINK-TO-CORE";
        aggregated-ether-options {
            lacp { active; periodic fast; }
        }
        unit 0 {
            family ethernet-switching {
                interface-mode trunk;
                vlan { members [MGMT CORP VOICE WIRELESS SERVER]; }
            }
        }
    }
    et-0/0/48 { ether-options { 802.3ad ae0; } }
    et-0/0/49 { ether-options { 802.3ad ae0; } }
}
storm-control {
    default { bandwidth-level 10; }
}`;

  return '';
}

/* ════════════════════════════════════════════════════════════
   9. WIRELESS / Wi-Fi
   Applies: campus-access (AP uplinks + WLC config)
   Corp WPA3-Enterprise, Guest OWE, IoT MAB, RF profiles
════════════════════════════════════════════════════════════ */
function _polWireless(dev, os, R) {
  if (!R.hasWifi && !R.isCampus) return '';
  if (!R.isAccess && !R.isCore) return '';

  if (os === 'ios-xe' && R.isAccess) return `
! ── Wireless — AP Uplink Configuration ─────────────────────
! Access switch ports facing Cisco APs (802.3at PoE+ or PoE++)
interface range GigabitEthernet1/0/45-48
 description AP-UPLINK-CAPWAP
 switchport mode trunk
 switchport trunk native vlan 40
 switchport trunk allowed vlan 10,21,40,41,61
 spanning-tree portfast trunk
 spanning-tree bpduguard enable
 power inline auto max 30000
 ip dhcp snooping limit rate 25
 no shutdown
!
! CAPWAP/LWAPP data/control VLANs forwarded on trunk
! Corp SSID  → VLAN 40 (10.30.0.0/22)
! Guest SSID → VLAN 41 (10.31.0.0/22)
! IoT SSID   → VLAN 61 (10.60.0.0/23)`;

  if (os === 'ios-xe' && R.isCore) return `
! ── WLC Integration (Campus Core) ───────────────────────────
! Cisco Catalyst 9800-CL (cloud WLC) or physical 9800-80
! CAPWAP tunnels terminate on WLC in management network
!
interface Vlan40
 description WIRELESS-CORP (Corp SSID — WPA3-Enterprise)
 ip address 10.30.0.1 255.255.252.0
 ip helper-address 10.0.0.20
 no shutdown
!
interface Vlan41
 description WIRELESS-GUEST (Guest SSID — OWE/open)
 ip address 10.31.0.1 255.255.252.0
 ip helper-address 10.0.0.20
 no shutdown
!
interface Vlan61
 description IOT-MGMT (IoT SSID — MAB, isolated)
 ip address 10.60.0.1 255.255.254.0
 ip helper-address 10.0.0.20
 no shutdown
!
! WLC Management SVI
interface Vlan10
 ip helper-address 10.0.0.20
!
! ── SSID Design Reference (configure on WLC) ────────────────
! CORP-WPA3:
!   Security: WPA3-Enterprise (802.1X → ISE)
!   VLAN:  40  RADIUS: 10.0.0.50/51
!   Band steering: 5GHz preferred / 6GHz if 802.11ax
!   QoS: WMM enabled, Platinum profile (DSCP EF for voice)
!
! GUEST-OWE:
!   Security: OWE (Opportunistic Wireless Encryption) + captive portal
!   VLAN:  41  RADIUS: none (open)
!   Rate limit: 5 Mbps per client
!   Client isolation: enabled
!
! IOT-MAB:
!   Security: MAC Authentication Bypass → ISE profiling
!   VLAN:  61  RADIUS: 10.0.0.50/51
!   Client isolation: enabled
!   DNS: allow only IoT cloud servers
!
! RF Profiles:
!   HIGH-DENSITY: TPC -65 dBm, max clients 25/radio, band-select enabled
!   STANDARD:     TPC -70 dBm, max clients 50/radio`;

  if (os === 'eos' && R.isAccess) return `
! ── Wireless AP Uplink (Arista EOS) ─────────────────────────
interface Ethernet45
   description AP-UPLINK-CAPWAP
   switchport mode trunk
   switchport trunk native vlan 40
   switchport trunk allowed vlan 10,21,40,41,61
   spanning-tree portfast
   spanning-tree bpduguard enable
   no shutdown`;

  return '';
}
