'use strict';

// ─── Symptom Classifier (G-37) ────────────────────────────────────────────────
// 150+ symptom→platform-commands entries covering BGP, EVPN, STP, DHCP,
// QoS, Interface, CPU, LLDP, VXLAN, Routing, Multicast.

var SYMPTOM_DB = [

  // ── BGP ──────────────────────────────────────────────────────────────────────
  { id:'BGP-01', cat:'BGP', symptom:'BGP neighbor stuck in Idle state',
    causes:['TCP reachability failure','ACL blocking port 179','Wrong source interface'],
    fix:'Verify TCP reachability: ping <neighbor> source <lo0>. Check ACLs on both ends.',
    cmds:{ nxos:['show bgp neighbors <ip>','show bgp summary','ping <ip> source loopback0'],
           eos: ['show bgp neighbors <ip>','show bgp summary','ping <ip> source loopback0'],
           junos:['show bgp neighbor <ip>','show bgp summary','ping <ip> routing-instance default'],
           sonic:['vtysh -c "show bgp neighbors <ip>"','vtysh -c "show bgp summary"'] }},

  { id:'BGP-02', cat:'BGP', symptom:'BGP neighbor in Active state (TCP connection failing)',
    causes:['Route to neighbor missing','Wrong update-source','BGP password mismatch'],
    fix:'Check "show ip route <neighbor>". Verify update-source loopback. Check MD5 key.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc State','show ip route <ip>','show run bgp | inc password'],
           eos: ['show bgp neighbors <ip>','show ip route <ip>'],
           junos:['show bgp neighbor <ip>','show route <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip>"','ip route show <ip>'] }},

  { id:'BGP-03', cat:'BGP', symptom:'BGP session flapping repeatedly',
    causes:['BFD misconfiguration','Hold timer too low','MTU mismatch on P2P link','CPU overload'],
    fix:'Check BFD timers match both ends. Verify MTU with "ping size 9100 df-bit". Check CPU.',
    cmds:{ nxos:['show bgp neighbors <ip> flap-statistics','show bfd neighbors','show ip mtu'],
           eos: ['show bgp neighbors <ip>','show bfd peers','ping <ip> size 9100 df-bit'],
           junos:['show bgp neighbor <ip>','show bfd session'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-04', cat:'BGP', symptom:'BGP neighbor established but no routes received',
    causes:['Missing send-community','No network/redistribute statement','Route-map filtering all'],
    fix:'Verify send-community extended. Check inbound route-maps. Verify neighbor advertises prefixes.',
    cmds:{ nxos:['show bgp neighbors <ip> received-routes','show bgp neighbors <ip> | inc Community'],
           eos: ['show bgp neighbors <ip> received-routes','show bgp neighbors <ip> advertised-routes'],
           junos:['show bgp neighbor <ip> received-routes','show route receive-protocol bgp <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip> received-routes"'] }},

  { id:'BGP-05', cat:'BGP', symptom:'BGP routes not installed in RIB (best-path not selected)',
    causes:['Higher AD from another protocol','AS path loop (iBGP)','ECMP disabled','Next-hop unreachable'],
    fix:'Check "show bgp <prefix> detail" for best-path selection. Verify next-hop reachability.',
    cmds:{ nxos:['show bgp <prefix>','show ip route <prefix>','show bgp nexthop'],
           eos: ['show bgp <prefix> detail','show ip route <prefix>'],
           junos:['show route <prefix> detail','show bgp summary'],
           sonic:['vtysh -c "show bgp <prefix>"','ip route show <prefix>'] }},

  { id:'BGP-06', cat:'BGP', symptom:'BGP prefix limit reached — neighbor shutdown',
    causes:['Unexpected route leak','Route reflector sending full table','No maximum-prefix warning'],
    fix:'Temporarily raise maximum-prefix with warning-only. Identify leak source with received-routes.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc prefix','show bgp <vrf> all summary'],
           eos: ['show bgp neighbors <ip> | grep "maximum prefix"','show bgp summary'],
           junos:['show bgp neighbor <ip> | match "prefix"'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-07', cat:'BGP', symptom:'BGP convergence slow after link failure (>30s)',
    causes:['BGP hold timer default 180s','BFD not configured','No advertisement-interval 0'],
    fix:'Enable BFD. Set timers to 3/9 (DC) or 10/30 (WAN). Set advertisement-interval 0.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc timer','show bfd neighbors'],
           eos: ['show bgp neighbors <ip> | grep "BGP state"','show bfd peers'],
           junos:['show bgp neighbor <ip> | match "timer"','show bfd session'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-08', cat:'BGP', symptom:'eBGP ECMP paths not installed (CLOS fabric)',
    causes:['Missing bestpath as-path multipath-relax','Maximum-paths not configured','Different AS paths'],
    fix:'Add "bestpath as-path multipath-relax" and "maximum-paths 8" under BGP.',
    cmds:{ nxos:['show bgp <prefix>','show run bgp | inc multipath','show run bgp | inc maximum-paths'],
           eos: ['show bgp <prefix> detail','show run | section router bgp'],
           junos:['show route forwarding-table destination <prefix>','show bgp summary'],
           sonic:['vtysh -c "show bgp <prefix> detail"'] }},

  { id:'BGP-09', cat:'BGP', symptom:'BGP route reflector not reflecting routes to clients',
    causes:['Missing route-reflector-client under neighbor','Cluster-ID misconfiguration','Originator-ID loop'],
    fix:'Verify "route-reflector-client" configured. Check cluster-id matches across RR cluster.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc reflector','show bgp <prefix>'],
           eos: ['show bgp neighbors <ip>','show bgp <prefix> detail'],
           junos:['show bgp neighbor <ip>','show route <prefix> detail'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-10', cat:'BGP', symptom:'BGP authentication failure (MD5)',
    causes:['Password mismatch','Password applied on one side only','Special characters in password'],
    fix:'Re-enter password on both peers. Avoid spaces/special chars. Check "debug bgp authentication".',
    cmds:{ nxos:['show bgp neighbors <ip> | inc password','show run bgp | inc password'],
           eos: ['show bgp neighbors <ip>','debug ip bgp authentication'],
           junos:['show bgp neighbor <ip> | match auth'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-11', cat:'BGP', symptom:'BGP L2VPN EVPN AF not activated on neighbor',
    causes:['Missing "address-family l2vpn evpn" under neighbor','send-community extended missing'],
    fix:'Add l2vpn evpn AF and send-community extended. On NX-OS: "address-family l2vpn evpn" + "send-community extended".',
    cmds:{ nxos:['show bgp l2vpn evpn summary','show bgp neighbors <ip> | inc EVPN'],
           eos: ['show bgp evpn summary','show bgp neighbors <ip> evpn'],
           junos:['show bgp neighbor <ip>','show bgp l2vpn evpn summary'],
           sonic:['vtysh -c "show bgp l2vpn evpn summary"'] }},

  { id:'BGP-12', cat:'BGP', symptom:'BGP next-hop unchanged for iBGP (next-hop-self missing)',
    causes:['Route reflector not setting next-hop-self','iBGP peer cannot reach eBGP next-hop'],
    fix:'Add "next-hop-self" on iBGP sessions toward non-connected peers.',
    cmds:{ nxos:['show bgp <prefix> | inc Next-hop','show run bgp | inc next-hop'],
           eos: ['show bgp <prefix> detail','show run | section neighbor'],
           junos:['show bgp summary','show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bgp <prefix>"'] }},

  { id:'BGP-13', cat:'BGP', symptom:'BGP originator-ID loop (route not accepted)',
    causes:['RR client sending route back to originator','Missing cluster-list check'],
    fix:'Verify cluster-id uniqueness across route reflectors.',
    cmds:{ nxos:['show bgp <prefix>','show bgp neighbors <ip> | inc cluster'],
           eos: ['show bgp <prefix> detail'],
           junos:['show route <prefix> detail'],
           sonic:['vtysh -c "show bgp <prefix> detail"'] }},

  { id:'BGP-14', cat:'BGP', symptom:'BGP graceful restart not negotiated',
    causes:['Graceful restart disabled on one peer','Peer does not support GR capability'],
    fix:'Enable graceful restart on both sides. Check capability negotiation.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc graceful','show run bgp | inc graceful'],
           eos: ['show bgp neighbors <ip> | grep "Graceful"'],
           junos:['show bgp neighbor <ip> | match "Graceful"'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-15', cat:'BGP', symptom:'BGP update-source not matching configured loopback',
    causes:['Loopback interface down','Wrong loopback number in update-source'],
    fix:'Verify loopback interface is up/up and matches "update-source loopback<N>" config.',
    cmds:{ nxos:['show interface loopback0','show run bgp | inc update-source'],
           eos: ['show interface loopback0','show run | section router bgp'],
           junos:['show interfaces lo0','show bgp summary'],
           sonic:['ip link show lo','vtysh -c "show bgp summary"'] }},

  // ── EVPN ─────────────────────────────────────────────────────────────────────
  { id:'EVP-01', cat:'EVPN', symptom:'EVPN MAC entry not being learned (L2 table empty)',
    causes:['NVE source-interface loopback not up','BGP l2vpn evpn AF not active','VNI not in EVPN section'],
    fix:'Verify NVE1 up, loopback1 up, BGP EVPN AF active, VNI configured in evpn section.',
    cmds:{ nxos:['show nve vni','show bgp l2vpn evpn summary','show mac address-table','show nve peers'],
           eos: ['show bgp evpn summary','show mac address-table','show vxlan vni'],
           junos:['show evpn database','show bgp l2vpn evpn summary'],
           sonic:['vtysh -c "show evpn vni"','bridge fdb show'] }},

  { id:'EVP-02', cat:'EVPN', symptom:'VXLAN tunnel not forming between leaf nodes',
    causes:['VTEP IP unreachable','Loopback1 not advertised in underlay','MTU too small for VXLAN (need +50B)'],
    fix:'Ping VTEP IPs (loopback1). Verify loopback1 is in BGP table. Check MTU ≥ 1600 on underlay.',
    cmds:{ nxos:['show nve peers','show ip route <vtep-ip>','ping <vtep-ip> source loopback1'],
           eos: ['show vxlan vtep','show ip route <vtep-ip>','ping <vtep-ip> source loopback1'],
           junos:['show evpn instance','show route <vtep-ip>'],
           sonic:['vtysh -c "show evpn vni"','ip route show <vtep-ip>'] }},

  { id:'EVP-03', cat:'EVPN', symptom:'RT (route-target) mismatch — EVPN routes not imported',
    causes:['RT values differ between VTEPs','rt auto generates different values per ASN'],
    fix:'Check "show bgp l2vpn evpn <prefix>" for RT values. Set explicit RT if ASNs differ.',
    cmds:{ nxos:['show bgp l2vpn evpn <prefix>','show run nve | inc route-target'],
           eos: ['show bgp evpn <prefix>','show run | section vxlan'],
           junos:['show evpn database','show bgp l2vpn evpn'],
           sonic:['vtysh -c "show bgp l2vpn evpn detail"'] }},

  { id:'EVP-04', cat:'EVPN', symptom:'L3 VXLAN routing not working (inter-VRF traffic dropped)',
    causes:['L3VNI not configured','L3VNI VLAN/SVI missing','VRF not associated with L3VNI','advertise-pip missing'],
    fix:'Verify L3VNI in NVE, transit VLAN SVI up, VRF bound to L3VNI, "advertise-pip" enabled.',
    cmds:{ nxos:['show nve vni','show vrf','show run vrf <name>','show bgp l2vpn evpn type 5'],
           eos: ['show bgp evpn type ip-prefix','show vxlan vni','show vrf'],
           junos:['show evpn instance extensive','show bgp l2vpn evpn'],
           sonic:['vtysh -c "show evpn vni"','vtysh -c "show bgp l2vpn evpn"'] }},

  { id:'EVP-05', cat:'EVPN', symptom:'ARP suppression not working — flooding too high',
    causes:['arp-suppress not enabled in NVE VNI','Hosts using gratuitous ARP','Probe ARP not intercepted'],
    fix:'Verify "suppress-arp" under NVE VNI. Check "show ip arp suppression-cache".',
    cmds:{ nxos:['show ip arp suppression-cache detail','show nve vni','show run nve | inc suppress'],
           eos: ['show vxlan arp-cache','show run | section vxlan'],
           junos:['show evpn arp-cache'],
           sonic:['vtysh -c "show evpn arp-cache"'] }},

  { id:'EVP-06', cat:'EVPN', symptom:'MAC moves / MAC bouncing between ports',
    causes:['Dual-homed device without ESI','Loop in access layer','VM migration without EVPN move'],
    fix:'Enable ESI multi-homing for dual-attached endpoints. Check STP on access ports.',
    cmds:{ nxos:['show mac address-table','show bgp l2vpn evpn type 2','show system internal evpn event-history'],
           eos: ['show bgp evpn type mac-ip','show mac address-table'],
           junos:['show evpn database','show bgp l2vpn evpn'],
           sonic:['vtysh -c "show evpn mac vni all"','bridge fdb show'] }},

  { id:'EVP-07', cat:'EVPN', symptom:'Anycast gateway MAC not being used — traffic leaving VXLAN domain',
    causes:['fabric forwarding mode anycast-gateway not set','Gateway IP not configured on SVI'],
    fix:'Verify "fabric forwarding mode anycast-gateway" on SVI. Confirm same IP on all VTEPs.',
    cmds:{ nxos:['show fabric forwarding mode','show interface vlan<id>','show run int vlan<id>'],
           eos: ['show ip interface vlan<id>','show vxlan vni'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show evpn vni"'] }},

  { id:'EVP-08', cat:'EVPN', symptom:'EVPN RT-5 (IP prefix) routes not being imported',
    causes:['RT-5 not in rt_types list','redistribute direct route-map missing','advertise-pip not set'],
    fix:'Add "address-family ipv4 unicast" with "redistribute direct". Enable advertise-pip.',
    cmds:{ nxos:['show bgp l2vpn evpn type 5','show run bgp | inc redistribute'],
           eos: ['show bgp evpn type ip-prefix','show run | section router bgp'],
           junos:['show bgp l2vpn evpn','show evpn database'],
           sonic:['vtysh -c "show bgp l2vpn evpn type prefix"'] }},

  { id:'EVP-09', cat:'EVPN', symptom:'ESI multi-homing — designated forwarder election failure',
    causes:['ESI value mismatch between VTEP pair','LACP slow timers','BGP l2vpn evpn not converged'],
    fix:'Verify identical ESI values on both VTEPs. Check "show nve ethernet-segment".',
    cmds:{ nxos:['show nve ethernet-segment','show bgp l2vpn evpn type 1','show lacp neighbor'],
           eos: ['show bgp evpn type es','show evpn multihoming es'],
           junos:['show evpn instance extensive','show bgp l2vpn evpn'],
           sonic:['vtysh -c "show bgp l2vpn evpn type es"'] }},

  { id:'EVP-10', cat:'EVPN', symptom:'VXLAN VNI in "down" state on NVE interface',
    causes:['VLAN not in vn-segment mapping','Feature nv overlay not enabled','NVE source-interface down'],
    fix:'Check "feature nv overlay" and "feature vn-segment-vlan-based". Verify VLAN-to-VNI mapping.',
    cmds:{ nxos:['show nve vni','show vlan','show feature | inc nv','show interface nve1'],
           eos: ['show vxlan vni','show interface vxlan1'],
           junos:['show evpn instance'],
           sonic:['vtysh -c "show evpn vni"'] }},

  { id:'EVP-11', cat:'EVPN', symptom:'Ingress replication list empty — BUM traffic not flooding',
    causes:['No BGP EVPN peers with L2VNI','ingress-replication protocol bgp not set'],
    fix:'Verify "ingress-replication protocol bgp" under NVE VNI. Check BGP EVPN neighbor state.',
    cmds:{ nxos:['show nve vni','show nve peers detail','show bgp l2vpn evpn type 3'],
           eos: ['show bgp evpn type imet','show vxlan flood vtep'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show evpn vni detail"'] }},

  { id:'EVP-12', cat:'EVPN', symptom:'Duplicate MAC detected in EVPN fabric',
    causes:['MAC move storm','Loop in underlay','VM spawned on wrong VTEP without notification'],
    fix:'Check MAC move counters. Identify originating VTEP. Enable duplicate MAC detection.',
    cmds:{ nxos:['show bgp l2vpn evpn type 2 | inc duplicate','show mac address-table'],
           eos: ['show bgp evpn type mac-ip','show mac address-table'],
           junos:['show evpn database extensive'],
           sonic:['vtysh -c "show evpn mac vni all"'] }},

  { id:'EVP-13', cat:'EVPN', symptom:'EVPN VRF routes not redistributed into underlay BGP',
    causes:['Missing "redistribute direct route-map RMAP-CONNECTED" in VRF AF','Route-map not defined'],
    fix:'Add "redistribute direct route-map RMAP-CONNECTED" in BGP VRF AF. Verify route-map exists.',
    cmds:{ nxos:['show run bgp | inc redistribute','show bgp vrf <name> ipv4 unicast'],
           eos: ['show bgp evpn type ip-prefix','show run | section router bgp'],
           junos:['show bgp l2vpn evpn'],
           sonic:['vtysh -c "show bgp vrf <name>"'] }},

  // ── STP ──────────────────────────────────────────────────────────────────────
  { id:'STP-01', cat:'STP', symptom:'BPDU Guard triggered — port in err-disabled state',
    causes:['Unmanaged switch connected to access port','Misconfigured PortFast on trunk'],
    fix:'Remove unauthorized switch. Disable BPDU guard on this port if trunk is expected. Re-enable: "shut / no shut".',
    cmds:{ nxos:['show interface <int> | inc err','show spanning-tree blockedports','show logging | inc BPDU'],
           eos: ['show interfaces <int> status','show spanning-tree blockedports'],
           junos:['show spanning-tree interface <int>'],
           sonic:['mstpctl showport <br> <int>'] }},

  { id:'STP-02', cat:'STP', symptom:'Suboptimal STP root bridge — traffic taking long path',
    causes:['Root bridge elected by default (lowest MAC)','Priority not manually set on distribution/core'],
    fix:'Set "spanning-tree vlan 1-4094 priority 4096" on primary distribution. Secondary: 8192.',
    cmds:{ nxos:['show spanning-tree vlan <id>','show spanning-tree root'],
           eos: ['show spanning-tree vlan <id>','show spanning-tree detail'],
           junos:['show spanning-tree bridge'],
           sonic:['mstpctl showbridge'] }},

  { id:'STP-03', cat:'STP', symptom:'Topology change notifications (TCN) causing MAC flush storms',
    causes:['Access port flapping','Device connected to access port with switches','No PortFast on access'],
    fix:'Enable PortFast on all access ports. Investigate flapping port. Check "show spanning-tree detail".',
    cmds:{ nxos:['show spanning-tree detail | inc change','show spanning-tree vlan <id> detail'],
           eos: ['show spanning-tree detail','show spanning-tree vlan <id>'],
           junos:['show spanning-tree statistics interface'],
           sonic:['mstpctl showport'] }},

  { id:'STP-04', cat:'STP', symptom:'STP port stuck in Blocking/Discarding state',
    causes:['Correct STP behavior (redundant link)','MSTP region mismatch','Bridge priority misconfigured'],
    fix:'Verify this is expected topology. Check MSTP region name/revision match on all switches.',
    cmds:{ nxos:['show spanning-tree vlan <id>','show spanning-tree mst configuration'],
           eos: ['show spanning-tree vlan <id>','show spanning-tree mst configuration'],
           junos:['show spanning-tree bridge','show spanning-tree interface'],
           sonic:['mstpctl showmstiport <msti> <br> <int>'] }},

  { id:'STP-05', cat:'STP', symptom:'PVST/MSTP mix causing instability',
    causes:['Different STP modes on interconnected switches','VLAN mapping mismatch in MST'],
    fix:'Standardize STP mode across all switches. On NX-OS: "spanning-tree mode mst".',
    cmds:{ nxos:['show spanning-tree vlan <id>','show spanning-tree summary'],
           eos: ['show spanning-tree summary'],
           junos:['show spanning-tree bridge'],
           sonic:['mstpctl showbridge'] }},

  { id:'STP-06', cat:'STP', symptom:'Layer 2 loop detected — MAC table flapping, high CPU',
    causes:['STP not running on VLAN','BPDU filter on wrong port','Dual-homed without EVPN ESI'],
    fix:'Check "show mac address-table | count" rising. Disable suspect port. Verify STP running.',
    cmds:{ nxos:['show mac address-table count','show spanning-tree summary','show logging | inc loop'],
           eos: ['show mac address-table count','show spanning-tree'],
           junos:['show ethernet-switching table'],
           sonic:['bridge fdb show | wc -l','mstpctl showbridge'] }},

  { id:'STP-07', cat:'STP', symptom:'Root guard preventing root port election',
    causes:['Root guard enabled on uplink toward intended root','New switch with lower priority'],
    fix:'Check "show spanning-tree inconsistentports". Remove root guard from intended root-facing port.',
    cmds:{ nxos:['show spanning-tree inconsistentports','show run int <int> | inc guard'],
           eos: ['show spanning-tree inconsistentports'],
           junos:['show spanning-tree interface'],
           sonic:['mstpctl showport'] }},

  { id:'STP-08', cat:'STP', symptom:'MST region mismatch — switch shows as external to region',
    causes:['Different MST region name/revision/VLAN-instance map','Case-sensitive region name'],
    fix:'Verify "spanning-tree mst configuration" name, revision, and instance-to-VLAN mapping match exactly.',
    cmds:{ nxos:['show spanning-tree mst configuration','show spanning-tree mst 0'],
           eos: ['show spanning-tree mst configuration'],
           junos:['show spanning-tree mstp configuration'],
           sonic:['mstpctl showmstiport 0'] }},

  // ── DHCP ─────────────────────────────────────────────────────────────────────
  { id:'DHCP-01', cat:'DHCP', symptom:'DHCP Discover not reaching server (no offer received)',
    causes:['No DHCP relay agent on SVI','Relay pointing to wrong server IP','Server unreachable'],
    fix:'Add "ip helper-address <server>" on SVI. Verify UDP port 67/68 not blocked.',
    cmds:{ nxos:['show run int vlan<id> | inc helper','show ip dhcp relay','ping <dhcp-server>'],
           eos: ['show run interfaces vlan<id>','show ip dhcp relay'],
           junos:['show interfaces <int> detail | match helper'],
           sonic:['cat /etc/dhcp/dhcpd.conf'] }},

  { id:'DHCP-02', cat:'DHCP', symptom:'DHCP pool exhausted — no addresses available',
    causes:['Stale leases from decommissioned devices','Pool too small for endpoint count','Lease time too long'],
    fix:'Check active leases. Clear stale. Expand pool or reduce lease time.',
    cmds:{ nxos:['show ip dhcp binding count','show ip dhcp binding | count','show ip dhcp pool'],
           eos: ['show ip dhcp binding count','show ip dhcp pool'],
           junos:['show dhcp server binding'],
           sonic:['cat /var/lib/dhcpd/dhcpd.leases | grep -c lease'] }},

  { id:'DHCP-03', cat:'DHCP', symptom:'DHCP snooping dropping packets on trunk port',
    causes:['Trust not set on uplink port','Snooping enabled on management VLAN inadvertently'],
    fix:'Set "ip dhcp snooping trust" on all uplink/trunk ports toward DHCP relay or server.',
    cmds:{ nxos:['show ip dhcp snooping','show ip dhcp snooping statistics','show run int <int> | inc trust'],
           eos: ['show dhcp snooping','show run interfaces <int>'],
           junos:['show dhcp snooping binding'],
           sonic:['show dhcp-snooping'] }},

  { id:'DHCP-04', cat:'DHCP', symptom:'DHCP relay not forwarding across VRF boundary',
    causes:['Relay configured without VRF context','VRF not specified in helper-address'],
    fix:'On NX-OS: "ip helper-address <ip> use-vrf <vrf>" on SVI in correct VRF.',
    cmds:{ nxos:['show ip dhcp relay','show run int vlan<id> | inc helper'],
           eos: ['show ip dhcp relay'],
           junos:['show dhcp relay binding'],
           sonic:['cat /etc/dhcp/dhcpd.conf'] }},

  { id:'DHCP-05', cat:'DHCP', symptom:'DHCP request succeeds but device cannot ping gateway',
    causes:['Wrong default gateway in DHCP offer','ARP failure for gateway IP','SVI/anycast gateway down'],
    fix:'Verify "default-router" in DHCP pool matches SVI/anycast GW IP. Check ARP on gateway.',
    cmds:{ nxos:['show ip dhcp binding <ip>','show ip arp','show interface vlan<id>'],
           eos: ['show ip dhcp binding','show arp','show ip interface vlan<id>'],
           junos:['show dhcp server binding','show arp'],
           sonic:['ip neigh show','ip addr show'] }},

  { id:'DHCP-06', cat:'DHCP', symptom:'DHCP starvation attack — pool flooded with bogus MACs',
    causes:['DHCP snooping not enabled','No MAC-based rate limiting on access ports'],
    fix:'Enable DHCP snooping. Rate-limit DHCP on access ports (max 15 pps).',
    cmds:{ nxos:['show ip dhcp snooping statistics','show ip dhcp binding count'],
           eos: ['show dhcp snooping','show dhcp snooping statistics'],
           junos:['show dhcp snooping binding'],
           sonic:['show dhcp-snooping'] }},

  // ── QoS ──────────────────────────────────────────────────────────────────────
  { id:'QOS-01', cat:'QoS', symptom:'Voice traffic experiencing jitter / packet loss',
    causes:['EF (DSCP 46) not in strict priority queue','Insufficient bandwidth for voice class','Queue tail-drop'],
    fix:'Verify EF in LLQ/priority queue. Allocate ≥20% bandwidth. Enable WRED on best-effort queue.',
    cmds:{ nxos:['show policy-map interface <int>','show queuing interface <int>'],
           eos: ['show policy-map interface <int>','show qos interface <int>'],
           junos:['show class-of-service interface <int> comprehensive'],
           sonic:['tc qdisc show dev <int>'] }},

  { id:'QOS-02', cat:'QoS', symptom:'QoS policy drops increasing on egress interface',
    causes:['Oversubscribed queue','Burst exceeding Tc interval','Missing tail-drop/WRED'],
    fix:'Check per-queue drop counters. Increase CIR. Enable WRED on AF classes.',
    cmds:{ nxos:['show policy-map interface <int> | inc drop','show queuing interface <int>'],
           eos: ['show qos interface <int> queues','show policy-map interface <int>'],
           junos:['show class-of-service interface <int> detail'],
           sonic:['tc -s qdisc show dev <int>'] }},

  { id:'QOS-03', cat:'QoS', symptom:'DSCP markings being remarked to 0 (best-effort) at boundary',
    causes:['No trust DSCP on ingress port','Edge policy re-marking all traffic','DSCP bleaching by carrier'],
    fix:'Add "mls qos trust dscp" / "trust dscp" on ingress port. Check carrier SLA for DSCP.',
    cmds:{ nxos:['show run int <int> | inc qos','show policy-map interface <int> input'],
           eos: ['show run interfaces <int> | grep qos','show policy-map interface <int>'],
           junos:['show class-of-service interface <int>'],
           sonic:['tc filter show dev <int>'] }},

  { id:'QOS-04', cat:'QoS', symptom:'QoS policy not applied to interface',
    causes:['service-policy command missing on interface','Wrong direction (input vs output)'],
    fix:'Apply "service-policy output <name>" on the congestion point (egress WAN/uplink).',
    cmds:{ nxos:['show run int <int> | inc service-policy','show policy-map interface <int>'],
           eos: ['show run interfaces <int>','show policy-map interface <int>'],
           junos:['show interfaces <int> detail | match scheduler'],
           sonic:['tc qdisc show dev <int>'] }},

  { id:'QOS-05', cat:'QoS', symptom:'Storage/NVMe traffic not getting correct DSCP',
    causes:['Storage flows not matched in class-map','ACL in class-map missing storage ports'],
    fix:'Match storage flows by DSCP AF31 or by port (iSCSI 3260, NVMe-oF 4420).',
    cmds:{ nxos:['show policy-map','show run policy-map'],
           eos: ['show policy-map','show run section policy-map'],
           junos:['show class-of-service forwarding-class'],
           sonic:['tc class show dev <int>'] }},

  { id:'QOS-06', cat:'QoS', symptom:'Policing dropping legitimate traffic spikes',
    causes:['CIR too low for burst','PIR not configured','Token bucket too small'],
    fix:'Increase CIR/PIR or use shaping instead of policing for bursty storage traffic.',
    cmds:{ nxos:['show policy-map interface <int>','show run policy-map <name>'],
           eos: ['show policy-map interface <int>'],
           junos:['show class-of-service interface <int>'],
           sonic:['tc filter show dev <int>'] }},

  { id:'QOS-07', cat:'QoS', symptom:'DSCP value not preserved in VXLAN encapsulation',
    causes:['Inner-to-outer DSCP copy not configured','QoS propagation disabled in NVE'],
    fix:'Enable DSCP copy for VXLAN: NX-OS "qos dscp-to-cos" + copy inner-to-outer in NVE.',
    cmds:{ nxos:['show run nve | inc qos','show run policy-map'],
           eos: ['show run | section qos','show vxlan config-sanity'],
           junos:['show class-of-service interface lo0'],
           sonic:['vtysh -c "show evpn vni"'] }},

  { id:'QOS-08', cat:'QoS', symptom:'HPC/GPU job slowdown — network congestion detected',
    causes:['PFC not enabled for RoCEv2','ECN thresholds too high','No DCQCN','RDMA queue unfair'],
    fix:'Enable PFC on cos3/4 for RoCEv2. Tune ECN min/max thresholds. Enable DCQCN.',
    cmds:{ nxos:['show interface priority-flow-control','show run qos | inc pfc'],
           eos: ['show interfaces <int> pfc','show qos profile'],
           junos:['show class-of-service interface <int>'],
           sonic:['pfcstat -i <int>','ecnconfig -l'] }},

  // ── Interface ─────────────────────────────────────────────────────────────────
  { id:'INT-01', cat:'Interface', symptom:'Interface showing high CRC / input errors',
    causes:['Faulty cable or SFP','Duplex mismatch','Electrical noise on copper'],
    fix:'Replace cable/SFP. Force speed+duplex if autoneg mismatch. Check DOM for optical power.',
    cmds:{ nxos:['show interface <int> counters errors','show interface <int> transceiver'],
           eos: ['show interfaces <int> counters errors','show interfaces <int> transceiver'],
           junos:['show interfaces <int> extensive | match "error"','show interfaces diagnostics <int>'],
           sonic:['ethtool -S <int>','ethtool -m <int>'] }},

  { id:'INT-02', cat:'Interface', symptom:'Interface input queue drops increasing',
    causes:['Inbound traffic burst exceeding buffer','Slow egress path (CPU-punted)','QoS rate limiting'],
    fix:'Check if traffic is being CPU-punted. Add input QoS policy. Check for broadcast storms.',
    cmds:{ nxos:['show interface <int> counters','show interface <int> | inc drop'],
           eos: ['show interfaces <int> counters','show interfaces <int> detail'],
           junos:['show interfaces <int> extensive'],
           sonic:['ethtool -S <int>','ip -s link show <int>'] }},

  { id:'INT-03', cat:'Interface', symptom:'Interface flapping (line protocol up/down)',
    causes:['SFP/cable issue','Signal degradation (DOM shows low Rx power)','Remote end cycling'],
    fix:'Check DOM optical levels. Replace SFP. Check remote device port config.',
    cmds:{ nxos:['show logging | inc <int>','show interface <int> transceiver','show interface <int>'],
           eos: ['show logging | grep <int>','show interfaces <int> transceiver'],
           junos:['show interfaces <int> extensive','show log messages | match <int>'],
           sonic:['journalctl -xe | grep <int>','ethtool -m <int>'] }},

  { id:'INT-04', cat:'Interface', symptom:'Autonegotiation failure — interface at wrong speed/duplex',
    causes:['Connected device forced to specific speed','Faulty SFP rejecting autoneg'],
    fix:'Force speed/duplex on both ends: "speed 10000 / duplex full". Check for half-duplex.',
    cmds:{ nxos:['show interface <int> | inc duplex','show run int <int> | inc speed'],
           eos: ['show interfaces <int> | grep duplex','show run interfaces <int>'],
           junos:['show interfaces <int> detail | match speed'],
           sonic:['ethtool <int>'] }},

  { id:'INT-05', cat:'Interface', symptom:'MTU mismatch causing packet fragmentation / black hole',
    causes:['Different MTU values on P2P link','Jumbo frames not enabled end-to-end','VXLAN overhead not accounted'],
    fix:'Set consistent MTU. For VXLAN: physical MTU ≥ 9216 → configure "mtu 9216" on all links.',
    cmds:{ nxos:['show interface <int> | inc MTU','show run int <int> | inc mtu'],
           eos: ['show interfaces <int> | grep MTU'],
           junos:['show interfaces <int> detail | match mtu'],
           sonic:['ip link show <int>','ethtool -k <int> | grep scatter'] }},

  { id:'INT-06', cat:'Interface', symptom:'SFP optical power low — signal below RX sensitivity',
    causes:['Dirty fiber connector','Bend radius violation','Wrong SFP for distance/fiber type'],
    fix:'Clean connectors. Check fiber continuity. Verify SFP type matches fiber (SMF/MMF, OS2/OM4).',
    cmds:{ nxos:['show interface <int> transceiver','show interface <int> transceiver detail'],
           eos: ['show interfaces <int> transceiver','show interfaces <int> transceiver detail'],
           junos:['show interfaces diagnostics <int>'],
           sonic:['ethtool -m <int>'] }},

  { id:'INT-07', cat:'Interface', symptom:'LAG / port-channel member flapping',
    causes:['LACP PDU not received','Speed mismatch on member port','Different hash policies'],
    fix:'Verify LACP mode matches (active/active). Check member port speed. Debug LACP negotiation.',
    cmds:{ nxos:['show port-channel summary','show lacp neighbor','show interface port-channel<N> counters'],
           eos: ['show port-channel summary','show lacp peer'],
           junos:['show lacp interfaces','show interfaces ae<N> detail'],
           sonic:['teamdctl team<N> state','ip link show team<N>'] }},

  { id:'INT-08', cat:'Interface', symptom:'Interface stuck in "notconnect" state with cable plugged in',
    causes:['Port shutdown','Wrong SFP module','Damaged RJ45 jack'],
    fix:'Check "no shutdown". Swap SFP. Test cable with different cable.',
    cmds:{ nxos:['show interface <int>','show run int <int> | inc shut'],
           eos: ['show interfaces <int> status','show run interfaces <int>'],
           junos:['show interfaces <int>'],
           sonic:['ip link show <int>'] }},

  { id:'INT-09', cat:'Interface', symptom:'Out-of-band management interface unreachable',
    causes:['Management VRF not configured','Default route missing in mgmt VRF','ACL blocking SSH/HTTPS'],
    fix:'Verify "vrf member management" on mgmt interface. Add default route in management VRF.',
    cmds:{ nxos:['show vrf management','show ip route vrf management','show run vrf management'],
           eos: ['show vrf management','show ip route vrf management'],
           junos:['show route table mgmt.inet.0'],
           sonic:['ip vrf exec mgmt ip route show'] }},

  { id:'INT-10', cat:'Interface', symptom:'802.1Q VLAN not passing on trunk port',
    causes:['VLAN not in allowed list on trunk','VLAN not created on switch','Native VLAN mismatch'],
    fix:'Add VLAN to trunk: "switchport trunk allowed vlan add <id>". Create VLAN if missing.',
    cmds:{ nxos:['show interface <int> trunk','show vlan','show run int <int>'],
           eos: ['show interfaces <int> trunk','show vlan'],
           junos:['show interfaces <int> detail | match vlan'],
           sonic:['bridge vlan show dev <int>'] }},

  // ── CPU ───────────────────────────────────────────────────────────────────────
  { id:'CPU-01', cat:'CPU', symptom:'High control-plane CPU utilization (>80%)',
    causes:['Routing table churn','COPP policer not configured','DoS/DDoS against device','STP TCN storm'],
    fix:'Check "show processes cpu sort" top consumers. Enable CoPP. Identify and block attack traffic.',
    cmds:{ nxos:['show processes cpu sort','show system resources','show copp status'],
           eos: ['show processes top once','show system resources','show copp traffic'],
           junos:['show chassis routing-engine','show system processes extensive'],
           sonic:['top -bn1','cat /proc/loadavg'] }},

  { id:'CPU-02', cat:'CPU', symptom:'BGP process consuming high CPU',
    causes:['BGP table churn (route flap)','Too many BGP peers','Route reflector with full table'],
    fix:'Check flapping routes. Increase route dampening. Use route filters to reduce prefixes.',
    cmds:{ nxos:['show processes cpu | inc bgp','show bgp all summary | inc Active'],
           eos: ['show processes top once | grep bgp','show bgp summary'],
           junos:['show system processes extensive | match rpd'],
           sonic:['ps aux | grep bgp','vtysh -c "show bgp summary"'] }},

  { id:'CPU-03', cat:'CPU', symptom:'Control-plane punted traffic — slow-path overwhelming CPU',
    causes:['COPP rate exceeded','Too many ARP/DHCP broadcasts','ACL logging enabled at scale'],
    fix:'Configure CoPP policies. Rate-limit ARP. Disable ACL logging if not needed.',
    cmds:{ nxos:['show copp status','show hardware rate-limiter','show system internal access-list resource usage'],
           eos: ['show copp traffic','show hardware capacity utilization'],
           junos:['show ddos-protection protocols'],
           sonic:['cat /sys/kernel/debug/sai/*copp*'] }},

  { id:'CPU-04', cat:'CPU', symptom:'Memory exhaustion on control plane',
    causes:['Route table too large','BGP RIB memory leak','Software bug — process memory runaway'],
    fix:'Check "show system resources" for memory usage. Identify top consumers. Filter BGP routes.',
    cmds:{ nxos:['show system resources','show processes memory sort'],
           eos: ['show system resources','show processes top once'],
           junos:['show chassis routing-engine','show system virtual-memory'],
           sonic:['free -h','cat /proc/meminfo'] }},

  { id:'CPU-05', cat:'CPU', symptom:'Packet buffer drops in hardware (ASIC)',
    causes:['Microbursts','Congestion on egress port','Tail-drop without WRED'],
    fix:'Enable WRED on congested queues. Check for microbursts with port buffer stats.',
    cmds:{ nxos:['show hardware internal buffer info pkt-stats','show queuing interface <int>'],
           eos: ['show platform trident queue-monitor','show hardware capacity utilization'],
           junos:['show class-of-service interface <int> comprehensive'],
           sonic:['redis-cli -n 1 hgetall "ASIC_STATE:SAI_OBJECT_TYPE_INGRESS_PRIORITY_GROUP"'] }},

  // ── LLDP / CDP ───────────────────────────────────────────────────────────────
  { id:'LLDP-01', cat:'LLDP', symptom:'LLDP neighbor not appearing on expected port',
    causes:['LLDP disabled globally or on port','Neighbor does not support LLDP','LLDP holdtime expired'],
    fix:'Verify "feature lldp" enabled. Check "lldp enable" per-interface. Confirm remote supports LLDP.',
    cmds:{ nxos:['show lldp neighbors','show feature | inc lldp','show run int <int> | inc lldp'],
           eos: ['show lldp neighbors','show run interfaces <int> | grep lldp'],
           junos:['show lldp neighbors','show lldp interface <int>'],
           sonic:['lldpctl','lldpctl <int>'] }},

  { id:'LLDP-02', cat:'LLDP', symptom:'LLDP neighbor showing wrong port description',
    causes:['interface description not configured','Hostname not set'],
    fix:'Set interface descriptions: "description <hostname>_<port>". Set correct hostname.',
    cmds:{ nxos:['show lldp neighbors detail','show run | inc hostname'],
           eos: ['show lldp neighbors detail'],
           junos:['show lldp neighbors detail'],
           sonic:['lldpctl -f keyvalue'] }},

  { id:'LLDP-03', cat:'LLDP', symptom:'CDP neighbor not seen from Cisco device',
    causes:['CDP disabled globally or per-interface','Neighbor does not run CDP (non-Cisco)'],
    fix:'Enable CDP: "cdp enable" globally and per-interface. Non-Cisco devices use LLDP.',
    cmds:{ nxos:['show cdp neighbors','show run | inc cdp','show cdp interface'],
           eos: ['show cdp neighbors (if enabled)'],
           junos:['show lldp neighbors (JunOS uses LLDP not CDP)'],
           sonic:['lldpctl'] }},

  { id:'LLDP-04', cat:'LLDP', symptom:'LLDP TLV not advertising management IP',
    causes:['Management TLV not in LLDP transmit list','Wrong management VLAN configured'],
    fix:'Enable management-address TLV. Verify management IP is set on management interface.',
    cmds:{ nxos:['show lldp tlv-select','show run | inc lldp'],
           eos: ['show lldp neighbors detail | grep management'],
           junos:['show lldp neighbors detail'],
           sonic:['lldpctl -f keyvalue | grep mgmt'] }},

  { id:'LLDP-05', cat:'LLDP', symptom:'LLDP used for topology discovery shows incomplete graph',
    causes:['Some devices lack LLDP','Access layer devices disabled LLDP','LLDP blocked by VLAN'],
    fix:'Enable LLDP on all devices. Verify LLDP PDUs not filtered on trunk ports.',
    cmds:{ nxos:['show lldp neighbors','show lldp neighbors detail'],
           eos: ['show lldp neighbors detail'],
           junos:['show lldp neighbors'],
           sonic:['lldpctl'] }},

  // ── VXLAN / Underlay ──────────────────────────────────────────────────────────
  { id:'VXL-01', cat:'VXLAN', symptom:'VXLAN packets being fragmented — MTU too small',
    causes:['Underlay MTU set to 1500 (default)','VXLAN adds 50B overhead','Jumbo frames not end-to-end'],
    fix:'Set MTU to 9216 (or ≥1550 minimum) on all underlay P2P links and loopbacks.',
    cmds:{ nxos:['show interface <int> | inc MTU','show run int <int> | inc mtu'],
           eos: ['show interfaces <int> | grep MTU'],
           junos:['show interfaces <int> detail | match MTU'],
           sonic:['ip link show <int>'] }},

  { id:'VXL-02', cat:'VXLAN', symptom:'VTEP sourcing from wrong IP (not loopback)',
    causes:['NVE source-interface not configured correctly','Multiple loopbacks — wrong one set'],
    fix:'Verify "source-interface loopback1" under NVE interface. Loopback1 = VTEP IP (not Lo0).',
    cmds:{ nxos:['show nve interface nve1','show run interface nve1'],
           eos: ['show vxlan config-sanity','show run interface vxlan1'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show evpn vni"'] }},

  { id:'VXL-03', cat:'VXLAN', symptom:'BUM traffic not being flooded to all VTEPs',
    causes:['Ingress-replication list incomplete','BGP EVPN type-3 routes not received','Multicast underlay failed'],
    fix:'Check type-3 (IMET) routes in BGP EVPN table. Verify all VTEP IPs in ingress-replication list.',
    cmds:{ nxos:['show bgp l2vpn evpn type 3','show nve peers','show nve vni'],
           eos: ['show bgp evpn type imet','show vxlan flood vtep'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show bgp l2vpn evpn type multicast"'] }},

  { id:'VXL-04', cat:'VXLAN', symptom:'VXLAN traffic asymmetric (traffic in but not out)',
    causes:['VTEP IP not symmetric','Asymmetric routing mode — L3VNI missing','IRB misconfiguration'],
    fix:'Use symmetric IRB mode. Ensure L3VNI configured on all VTEPs for each VRF.',
    cmds:{ nxos:['show nve vni','show vrf','show bgp l2vpn evpn type 5'],
           eos: ['show bgp evpn type ip-prefix','show vxlan vni'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show evpn vni detail"'] }},

  { id:'VXL-05', cat:'VXLAN', symptom:'VXLAN encapsulated traffic being dropped by firewall',
    causes:['Firewall not allowing UDP 4789','Deep inspection decapsulating/modifying inner packet'],
    fix:'Allow UDP 4789 between all VTEP pairs. Disable deep inspection on VXLAN flows.',
    cmds:{ nxos:['show ip access-list','show run | inc access-list'],
           eos: ['show ip access-lists','show run | section ip access-list'],
           junos:['show firewall filter','show interfaces <int> detail'],
           sonic:['iptables -L -n | grep 4789'] }},

  // ── Routing ───────────────────────────────────────────────────────────────────
  { id:'RTE-01', cat:'Routing', symptom:'Route missing from RIB — traffic being dropped',
    causes:['Redistribution not configured','Route filtered by route-map','Recursive next-hop failure'],
    fix:'Check "show ip route <prefix>". Trace from source protocol. Verify redistribution and route-maps.',
    cmds:{ nxos:['show ip route <prefix>','show bgp <prefix>','show ip ospf route'],
           eos: ['show ip route <prefix> detail','show bgp <prefix>'],
           junos:['show route <prefix> detail','show bgp summary'],
           sonic:['ip route show <prefix>','vtysh -c "show ip route <prefix>"'] }},

  { id:'RTE-02', cat:'Routing', symptom:'Routing loop detected — TTL exceeded packets',
    causes:['Static route pointing wrong next-hop','Redistribution loop between protocols','BGP and IGP conflict'],
    fix:'Traceroute to identify loop path. Check for mutual redistribution without route tags.',
    cmds:{ nxos:['traceroute <dst>','show ip route <prefix>','show run | inc redistribute'],
           eos: ['traceroute <dst>','show ip route <prefix> detail'],
           junos:['traceroute <dst>','show route <prefix> detail'],
           sonic:['traceroute <dst>','ip route show <prefix>'] }},

  { id:'RTE-03', cat:'Routing', symptom:'ECMP paths inconsistent — some flows taking wrong path',
    causes:['Hash polarization','ECMP max-paths mismatch','One path lower metric','5-tuple skew'],
    fix:'Enable "bestpath as-path multipath-relax". Verify all ECMP paths equal cost. Check hash algorithm.',
    cmds:{ nxos:['show ip route <prefix>','show run bgp | inc maximum-paths','show ip load-sharing'],
           eos: ['show ip route <prefix> detail','show ip ecmp'],
           junos:['show route forwarding-table destination <prefix>'],
           sonic:['ip route show <prefix>','vtysh -c "show bgp <prefix>"'] }},

  { id:'RTE-04', cat:'Routing', symptom:'Connected route not being redistributed into BGP',
    causes:['redistribute connected not configured','Route-map filtering connected routes','Route-map missing'],
    fix:'Add "redistribute connected route-map RMAP-CONNECTED". Verify route-map permits correct prefixes.',
    cmds:{ nxos:['show run bgp | inc redistribute','show ip route connected'],
           eos: ['show run | section router bgp','show ip route connected'],
           junos:['show bgp summary','show route protocol direct'],
           sonic:['vtysh -c "show run"','ip route show proto kernel'] }},

  { id:'RTE-05', cat:'Routing', symptom:'Default route not being advertised or accepted',
    causes:['default-information originate missing','Default route not in RIB','BGP default not propagated'],
    fix:'For OSPF: "default-information originate always". For BGP: "network 0.0.0.0/0" or "default-originate".',
    cmds:{ nxos:['show ip route 0.0.0.0','show bgp <prefix> 0.0.0.0/0'],
           eos: ['show ip route 0.0.0.0/0 longer-prefixes','show bgp 0.0.0.0'],
           junos:['show route 0.0.0.0'],
           sonic:['ip route show 0.0.0.0/0','vtysh -c "show ip route 0.0.0.0/0"'] }},

  { id:'RTE-06', cat:'Routing', symptom:'VRF route leak not working — inter-VRF traffic dropped',
    causes:['RT import/export not configured','Route-map blocking leaked prefixes','VRF not in BGP'],
    fix:'Configure matching RT import/export. Verify "address-family ipv4" in both VRFs with correct RT.',
    cmds:{ nxos:['show vrf','show ip route vrf <name>','show run vrf | inc route-target'],
           eos: ['show ip route vrf <name>','show run | section vrf'],
           junos:['show route table <vrf>.inet.0','show bgp l3vpn'],
           sonic:['vtysh -c "show ip route vrf <name>"'] }},

  { id:'RTE-07', cat:'Routing', symptom:'OSPF adjacency not forming — stuck in EXSTART/EXCHANGE',
    causes:['MTU mismatch','Hello/dead interval mismatch','Area type mismatch (stub vs backbone)'],
    fix:'Match MTU: "ip ospf mtu-ignore" temporarily for diagnosis. Match timers. Check area config.',
    cmds:{ nxos:['show ip ospf neighbors detail','show interface <int> | inc MTU'],
           eos: ['show ip ospf neighbor detail','show interfaces <int>'],
           junos:['show ospf neighbor detail','show interfaces <int> detail'],
           sonic:['vtysh -c "show ip ospf neighbor detail"'] }},

  // ── Multicast ─────────────────────────────────────────────────────────────────
  { id:'MCA-01', cat:'Multicast', symptom:'Multicast traffic not reaching receivers',
    causes:['PIM not enabled on all interfaces','RP unreachable','IGMP snooping dropping groups'],
    fix:'Enable PIM sparse-mode on all transit interfaces. Verify RP address reachable. Check IGMP joins.',
    cmds:{ nxos:['show ip pim interface','show ip pim rp','show ip igmp groups'],
           eos: ['show ip pim interfaces','show ip pim rp-info','show ip igmp groups'],
           junos:['show pim interfaces','show pim rps','show igmp groups'],
           sonic:['vtysh -c "show ip pim interface"','vtysh -c "show ip igmp groups"'] }},

  { id:'MCA-02', cat:'Multicast', symptom:'RP not reachable — no (S,G) or (*,G) state',
    causes:['RP address not configured','RP address unreachable in routing table','BSR/Auto-RP failure'],
    fix:'Verify RP address configured ("ip pim rp-address <ip>"). Check RP reachability via ping.',
    cmds:{ nxos:['show ip pim rp','show ip route <rp-address>','ping <rp-address>'],
           eos: ['show ip pim rp-info','show ip route <rp-address>'],
           junos:['show pim rps','show route <rp>'],
           sonic:['vtysh -c "show ip pim rp-info"'] }},

  { id:'MCA-03', cat:'Multicast', symptom:'IGMP snooping dropping multicast to endpoints',
    causes:['IGMP snooping mrouter port not detected','Querier not present on VLAN'],
    fix:'Verify mrouter port detected. Configure static mrouter port if needed. Check IGMP querier.',
    cmds:{ nxos:['show ip igmp snooping','show ip igmp snooping mrouter','show ip igmp snooping groups'],
           eos: ['show ip igmp snooping','show ip igmp snooping mrouter'],
           junos:['show igmp snooping membership'],
           sonic:['bridge mdb show'] }},

  { id:'MCA-04', cat:'Multicast', symptom:'SPT switchover not happening — staying on shared tree',
    causes:['SPT-threshold set to infinity','(S,G) join not triggered','RPF check failing'],
    fix:'Lower SPT threshold: "ip pim spt-threshold 0". Verify RPF interface for source.',
    cmds:{ nxos:['show ip pim route','show ip mroute','show ip pim rpf <source>'],
           eos: ['show ip pim route','show ip mroute'],
           junos:['show pim join extensive','show multicast route extensive'],
           sonic:['vtysh -c "show ip mroute"'] }},

  // ── Security / ACL ───────────────────────────────────────────────────────────
  { id:'SEC-01', cat:'Security', symptom:'ACL blocking legitimate traffic',
    causes:['Implicit deny at end of ACL','Incorrect permit order','Wrong source/destination in ACL entry'],
    fix:'Add explicit permit before implicit deny. Enable ACL logging temporarily to identify matching traffic.',
    cmds:{ nxos:['show ip access-list <name>','show run int <int> | inc access-group'],
           eos: ['show ip access-lists <name>','show run interfaces <int>'],
           junos:['show firewall filter <name>','show interfaces <int> detail'],
           sonic:['iptables -L <name> -v -n --line-numbers'] }},

  { id:'SEC-02', cat:'Security', symptom:'SSH not reachable to device',
    causes:['SSH not enabled','ACL blocking port 22','VRF not specified in SSH connection','SSH key expired'],
    fix:'Check "feature ssh" enabled. Verify ACL. Use "ssh -vvv" to debug. Check management VRF.',
    cmds:{ nxos:['show feature | inc ssh','show run | inc ssh','show ip access-list'],
           eos: ['show management ssh','show run | section management ssh'],
           junos:['show system connections | match 22','show configuration system services'],
           sonic:['systemctl status sshd','ss -tlnp | grep 22'] }},

  { id:'SEC-03', cat:'Security', symptom:'Control-plane being flooded — CoPP drops increasing',
    causes:['DoS attack targeting device','STP TCN storm','ARP broadcast storm','Routing protocol storm'],
    fix:'Identify top traffic class in CoPP drops. Rate-limit offending class. Block at upstream edge.',
    cmds:{ nxos:['show copp status','show system internal copp stats','show ip arp'],
           eos: ['show copp traffic','show hardware capacity'],
           junos:['show ddos-protection protocols','show chassis fpc'],
           sonic:['cat /proc/net/softnet_stat','sar -n DEV 1 5'] }},

  // ── RoCEv2 / RDMA ─────────────────────────────────────────────────────────────
  { id:'ROCE-01', cat:'RoCEv2', symptom:'RDMA traffic experiencing retransmissions',
    causes:['PFC frames being dropped','ECN not marking early enough','DCQCN not configured'],
    fix:'Verify PFC enabled on CoS3 for RoCEv2. Lower ECN min threshold. Enable DCQCN on all paths.',
    cmds:{ nxos:['show interface priority-flow-control','show queuing interface <int>'],
           eos: ['show interfaces <int> pfc','show qos interface <int>'],
           junos:['show class-of-service interface <int> comprehensive'],
           sonic:['pfcstat -i <int>','ecnconfig -l','rdmatool stats show'] }},

  { id:'ROCE-02', cat:'RoCEv2', symptom:'PFC pause frames causing head-of-line blocking',
    causes:['PFC deadlock','Too many hops with PFC enabled','ECN thresholds too high'],
    fix:'Enable PFC watchdog. Limit PFC hops to 2 (leaf→spine only). Lower ECN max threshold.',
    cmds:{ nxos:['show interface priority-flow-control','show run qos | inc pfc'],
           eos: ['show interfaces pfc','show run | section qos profile'],
           junos:['show class-of-service interface <int>'],
           sonic:['pfcstat -i <int>','ecnconfig -g <int>'] }},

  // ── ZTP / Day-0 ───────────────────────────────────────────────────────────────
  { id:'ZTP-01', cat:'ZTP', symptom:'Device not initiating ZTP / POAP on boot',
    causes:['ZTP disabled in startup config','DHCP option 43/67/150 not set','Firewall blocking TFTP'],
    fix:'Boot to clean state (erase startup). Verify DHCP options. Allow TFTP UDP/69 in firewall.',
    cmds:{ nxos:['show boot','debug poap'],
           eos: ['show ztp status','debug ztp'],
           junos:['show system ztp'],
           sonic:['cat /etc/sonic/config_db.json | grep -i ztp'] }},

  { id:'ZTP-02', cat:'ZTP', symptom:'ZTP script download failing',
    causes:['TFTP server unreachable','Wrong filename in DHCP option','Permissions on TFTP directory'],
    fix:'Ping TFTP server from management interface. Verify DHCP option 67 filename. Check TFTP perms.',
    cmds:{ nxos:['ping <tftp-server> vrf management','debug poap'],
           eos: ['show ztp status'],
           junos:['show system ztp'],
           sonic:['journalctl -u sonic-ztp'] }},

  // ── NTP / Time ────────────────────────────────────────────────────────────────
  { id:'NTP-01', cat:'NTP', symptom:'NTP not synchronizing — clock drift causing certificate failures',
    causes:['NTP server unreachable','Firewall blocking UDP 123','Wrong NTP source interface'],
    fix:'Verify reachability to NTP server. Allow UDP/123. Set source interface in management VRF.',
    cmds:{ nxos:['show ntp status','show ntp peers','ping <ntp-server> vrf management'],
           eos: ['show ntp status','show ntp associations'],
           junos:['show ntp status','show ntp associations'],
           sonic:['timedatectl status','chronyc tracking'] }},

  { id:'NTP-02', cat:'NTP', symptom:'Log timestamps showing wrong time / timezone',
    causes:['Timezone not configured','NTP synchronized but timezone wrong'],
    fix:'Set clock timezone: "clock timezone <tz>". Verify NTP sync and timezone in "show clock".',
    cmds:{ nxos:['show clock','show run | inc clock timezone'],
           eos: ['show clock','show run | grep timezone'],
           junos:['show system uptime','show configuration system time-zone'],
           sonic:['timedatectl','date'] }},

  // ── BGP extended ─────────────────────────────────────────────────────────────
  { id:'BGP-16', cat:'BGP', symptom:'BGP confederation not routing correctly between sub-ASes',
    causes:['Confederation peers not listed','confederation identifier mismatch'],
    fix:'Verify confederation identifier matches on all members. List all sub-AS peers.',
    cmds:{ nxos:['show bgp summary','show run bgp | inc confederation'],
           eos: ['show bgp summary','show run | section router bgp'],
           junos:['show bgp summary','show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bgp summary"'] }},

  { id:'BGP-17', cat:'BGP', symptom:'BGP not advertising host routes (/32) to peers',
    causes:['Missing network statement or redistribute','Route-map filtering /32 prefixes','No "redistribute connected"'],
    fix:'Add explicit "network <lo0>/32" or "redistribute connected" with permit for /32.',
    cmds:{ nxos:['show bgp <prefix>/32','show run bgp | inc network'],
           eos: ['show bgp <prefix>/32','show run | section router bgp'],
           junos:['show route <prefix>/32','show bgp neighbor advertised-routes'],
           sonic:['vtysh -c "show bgp <prefix>/32"'] }},

  { id:'BGP-18', cat:'BGP', symptom:'BGP soft reconfiguration causing high memory',
    causes:['soft-reconfiguration inbound storing full RIB','Should use route-refresh capability instead'],
    fix:'Replace "soft-reconfiguration inbound" with route-refresh capability (default on modern platforms).',
    cmds:{ nxos:['show bgp neighbors <ip> | inc soft','show system resources'],
           eos: ['show bgp neighbors <ip> | grep "soft"'],
           junos:['show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-19', cat:'BGP', symptom:'BGP route dampening suppressing legitimate prefixes',
    causes:['Dampening half-life too long','Suppress limit too low','Flapping link triggering dampening'],
    fix:'Raise suppress limit or lower half-life. Check "show bgp <prefix>" for dampening status.',
    cmds:{ nxos:['show bgp <prefix>','show bgp dampened-paths'],
           eos: ['show bgp <prefix> detail','show bgp dampened-paths'],
           junos:['show route <prefix> detail','show bgp damping parameters'],
           sonic:['vtysh -c "show bgp <prefix>"'] }},

  { id:'BGP-20', cat:'BGP', symptom:'BGP peer group update not applying to all members',
    causes:['Peer inheriting template after explicit override','Template not referenced by peer'],
    fix:'Verify "inherit peer <template>" under each neighbor. Check for overriding explicit statements.',
    cmds:{ nxos:['show run bgp | inc template peer','show bgp neighbors <ip> | inc inherit'],
           eos: ['show run | section router bgp'],
           junos:['show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  // ── EVPN extended ────────────────────────────────────────────────────────────
  { id:'EVP-14', cat:'EVPN', symptom:'EVPN type-2 MAC/IP route not being generated',
    causes:['ARP table not populated','Host not sending ARP','EVPN local learning disabled'],
    fix:'Verify host is ARPing gateway. Check "show ip arp <vlan>". Enable EVPN local learning.',
    cmds:{ nxos:['show bgp l2vpn evpn type 2','show ip arp','show mac address-table'],
           eos: ['show bgp evpn type mac-ip','show arp'],
           junos:['show evpn database','show arp'],
           sonic:['vtysh -c "show evpn mac vni all"','ip neigh show'] }},

  { id:'EVP-15', cat:'EVPN', symptom:'VNI showing "NVE: not registered" status',
    causes:['VNI not configured in evpn section','VLAN-to-VNI mapping missing','BGP not advertising VNI'],
    fix:'Add VNI to "evpn" section with RD/RT. Verify "vlan <id> / vn-segment <vni>" config.',
    cmds:{ nxos:['show nve vni','show run | inc vn-segment','show bgp l2vpn evpn'],
           eos: ['show vxlan vni','show run | section vxlan'],
           junos:['show evpn instance'],
           sonic:['vtysh -c "show evpn vni"'] }},

  // ── Interface extended ────────────────────────────────────────────────────────
  { id:'INT-11', cat:'Interface', symptom:'ECMP hash imbalance — one uplink saturated',
    causes:['5-tuple hash skew (same src/dst IP pattern)','Asymmetric LAG member count'],
    fix:'Enable adaptive hashing. Use GTP/MPLS-aware hashing for overlay traffic.',
    cmds:{ nxos:['show ip load-sharing','show interface <int> counters rate'],
           eos: ['show ip ecmp hash-algorithms','show interfaces <int> counters rates'],
           junos:['show pfe statistics traffic'],
           sonic:['ethtool -S <int> | grep tx_bytes'] }},

  { id:'INT-12', cat:'Interface', symptom:'Transceiver (SFP/QSFP) not recognized by switch',
    causes:['Third-party optic without vendor lock bypass','Wrong form factor (SFP+ vs QSFP28)'],
    fix:'Enable optics override if permitted. Verify correct SFP type for port speed.',
    cmds:{ nxos:['show interface <int> transceiver','show run | inc fec'],
           eos: ['show interfaces <int> transceiver','show inventory'],
           junos:['show chassis hardware','show interfaces diagnostics <int>'],
           sonic:['sfputil show eeprom -p <int>'] }},

  { id:'INT-13', cat:'Interface', symptom:'FEC mismatch causing high BER on 100G/400G link',
    causes:['FEC mode mismatch between peers','RS-FEC required but not enabled'],
    fix:'Enable RS-FEC on both ends: NX-OS "fec rs-fec", EOS "speed forced 100gfull fec rs".',
    cmds:{ nxos:['show interface <int> | inc FEC','show run int <int> | inc fec'],
           eos: ['show interfaces <int> | grep FEC','show run interfaces <int>'],
           junos:['show interfaces <int> detail | match FEC'],
           sonic:['ethtool <int> | grep FEC'] }},

  // ── Routing extended ─────────────────────────────────────────────────────────
  { id:'RTE-08', cat:'Routing', symptom:'OSPF route not being redistributed into BGP',
    causes:['redistribute ospf not configured','Route-map filtering OSPF routes','Tag mismatch'],
    fix:'Add "redistribute ospf <proc> route-map". Verify route-map permits desired prefixes.',
    cmds:{ nxos:['show run bgp | inc redistribute','show ip route ospf'],
           eos: ['show run | section router bgp','show ip route ospf'],
           junos:['show route protocol ospf','show bgp summary'],
           sonic:['vtysh -c "show ip route ospf"'] }},

  { id:'RTE-09', cat:'Routing', symptom:'Static route priority overriding dynamic route incorrectly',
    causes:['Administrative distance of static (1) beats OSPF/BGP','Floating static not configured'],
    fix:'Use "distance <AD>" on static to make it floating. Remove if dynamic route is preferred.',
    cmds:{ nxos:['show ip route <prefix>','show run | inc ip route'],
           eos: ['show ip route <prefix> detail'],
           junos:['show route <prefix> detail | match "preference"'],
           sonic:['ip route show <prefix>','vtysh -c "show ip route <prefix>"'] }},

  { id:'RTE-10', cat:'Routing', symptom:'Recursive next-hop resolution failing',
    causes:['Next-hop not in RIB','BGP next-hop via iBGP not reachable','IGP not carrying next-hop loopback'],
    fix:'Verify next-hop loopback is in IGP. Check "show ip route <next-hop>".',
    cmds:{ nxos:['show ip route <next-hop>','show bgp nexthop'],
           eos: ['show ip route <next-hop>','show bgp nexthop-table'],
           junos:['show route <next-hop>','show bgp summary'],
           sonic:['ip route show <next-hop>','vtysh -c "show bgp nexthop"'] }},

  // ── VXLAN extended ───────────────────────────────────────────────────────────
  { id:'VXL-06', cat:'VXLAN', symptom:'VXLAN head-end replication list growing unbounded',
    causes:['Old VTEP entries not aged out','BGP EVPN type-3 withdrawals missing'],
    fix:'Verify BGP session stable. Check type-3 route withdrawals on removed VTEPs.',
    cmds:{ nxos:['show nve peers','show bgp l2vpn evpn type 3'],
           eos: ['show vxlan flood vtep','show bgp evpn type imet'],
           junos:['show evpn instance extensive'],
           sonic:['vtysh -c "show evpn vni detail"'] }},

  { id:'VXL-07', cat:'VXLAN', symptom:'VXLAN inner packet checksum error',
    causes:['UDP checksum offload issue','NIC not computing VXLAN inner checksum'],
    fix:'Disable UDP checksum offload on VTEP: "ethtool -K <int> tx-udp_tnl-csum-segmentation off".',
    cmds:{ nxos:['show interface <int> counters errors'],
           eos: ['show interfaces <int> counters errors'],
           junos:['show interfaces <int> extensive | match error'],
           sonic:['ethtool -k <int> | grep checksum','ethtool -S <int>'] }},

  // ── Security extended ─────────────────────────────────────────────────────────
  { id:'SEC-04', cat:'Security', symptom:'802.1X authentication failing for wired endpoint',
    causes:['RADIUS server unreachable','Wrong NAS IP','RADIUS shared secret mismatch'],
    fix:'Verify RADIUS reachability. Check NAS-IP and shared secret. Test with "test aaa" command.',
    cmds:{ nxos:['show dot1x','show aaa authentication','show radius server'],
           eos: ['show dot1x all','show aaa radius servers'],
           junos:['show dot1x interface','show radius'],
           sonic:['cat /etc/hostapd/hostapd.conf'] }},

  { id:'SEC-05', cat:'Security', symptom:'Port security violation — unauthorized MAC detected',
    causes:['Wrong device plugged in','MAC spoofing attempt','Sticky MAC limit exceeded'],
    fix:'Check violation mode. Review allowed MAC list. Check "show port-security interface".',
    cmds:{ nxos:['show port-security','show port-security interface <int>'],
           eos: ['show port-security','show run interfaces <int>'],
           junos:['show ethernet-switching interface <int>'],
           sonic:['bridge fdb show dev <int>'] }},

  { id:'SEC-06', cat:'Security', symptom:'uRPF dropping legitimate asymmetric return traffic',
    causes:['Strict uRPF on asymmetric path','Wrong RPF interface for prefix'],
    fix:'Switch to loose uRPF mode for asymmetrically routed prefixes.',
    cmds:{ nxos:['show run int <int> | inc urpf','show ip route <src-ip>'],
           eos: ['show run interfaces <int> | grep rpf','show ip route <src-ip>'],
           junos:['show interfaces <int> detail | match rpf'],
           sonic:['sysctl net.ipv4.conf.<int>.rp_filter'] }},

  // ── CPU extended ─────────────────────────────────────────────────────────────
  { id:'CPU-06', cat:'CPU', symptom:'Scheduler process consuming excessive CPU',
    causes:['Timer jitter from too many BGP timers','Per-prefix tracking','BFD sessions overloading scheduler'],
    fix:'Consolidate BGP peer groups. Reduce BFD sessions. Check for per-prefix tracking.',
    cmds:{ nxos:['show processes cpu | inc scheduler','show bfd neighbors count'],
           eos: ['show processes top once','show bfd peers brief'],
           junos:['show system processes extensive | head -20'],
           sonic:['top -bn1 | head -20'] }},

  { id:'CPU-07', cat:'CPU', symptom:'Hardware TCAM / FIB exhaustion',
    causes:['Too many routes for hardware table','ECMP paths consuming FIB entries','ACL entries overflowing TCAM'],
    fix:'Summarize routes. Reduce ECMP paths. Remove unused ACL entries. Add spine with larger FIB.',
    cmds:{ nxos:['show hardware capacity utilization','show system resources'],
           eos: ['show hardware capacity','show hardware capacity utilization'],
           junos:['show pfe statistics traffic','show chassis forwarding'],
           sonic:['redis-cli -n 1 HLEN "ASIC_STATE:SAI_OBJECT_TYPE_ROUTE_ENTRY:*"'] }},

  // ── Multicast extended ────────────────────────────────────────────────────────
  { id:'MCA-05', cat:'Multicast', symptom:'Multicast group join latency too high',
    causes:['PIM join delayed by hold-down','IGMP last-member query interval too long'],
    fix:'Reduce IGMP last-member-query-interval to 1s. Check PIM propagation delay.',
    cmds:{ nxos:['show ip igmp interface','show ip pim statistics'],
           eos: ['show ip igmp groups','show ip pim interface'],
           junos:['show igmp interface','show pim interfaces detail'],
           sonic:['vtysh -c "show ip igmp interface"'] }},

  { id:'MCA-06', cat:'Multicast', symptom:'Multicast replication causing line-rate drops',
    causes:['Hardware replication limit exceeded','Too many (S,G) entries in hardware'],
    fix:'Check hardware multicast table utilization. Summarize multicast groups if possible.',
    cmds:{ nxos:['show ip mroute count','show hardware capacity | inc multicast'],
           eos: ['show ip mroute count','show hardware capacity'],
           junos:['show pim statistics'],
           sonic:['vtysh -c "show ip mroute"'] }},

  // ── RoCEv2 extended ────────────────────────────────────────────────────────────
  { id:'ROCE-03', cat:'RoCEv2', symptom:'RDMA queue pair stuck — cannot establish connection',
    causes:['Subnet manager not running (InfiniBand)','GID resolution failing for RoCEv2','Wrong MTU for RDMA'],
    fix:'Verify subnet manager (opensm) running. Check GID index. MTU must be ≥4096 for RDMA.',
    cmds:{ nxos:['show interface priority-flow-control','show interface <int>'],
           eos: ['show interfaces <int>','show qos interface <int>'],
           junos:['show class-of-service interface <int>'],
           sonic:['ibstat','ibping -g <GID>','rdmatool dev show'] }},

  { id:'ROCE-04', cat:'RoCEv2', symptom:'DCQCN marking too aggressive — throughput collapse',
    causes:['ECN marking threshold too low','DCQCN reaction timer too short','Incast causing synchronized drops'],
    fix:'Raise ECN Kmin threshold. Increase DCQCN timer. Use per-flow ECMP for incast.',
    cmds:{ nxos:['show run qos | inc ecn','show queuing interface <int>'],
           eos: ['show qos interface <int>','show run | section qos profile'],
           junos:['show class-of-service interface <int> comprehensive'],
           sonic:['ecnconfig -l','rdmatool stats show'] }},

  // ── OSPF ─────────────────────────────────────────────────────────────────────
  { id:'OSPF-01', cat:'Routing', symptom:'OSPF adjacency flapping due to Hello timer mismatch',
    causes:['Hello interval different between peers','Dead interval mismatch'],
    fix:'Standardize timers: "ip ospf hello-interval 1 / dead-interval 3" (for DC) on both sides.',
    cmds:{ nxos:['show ip ospf neighbors detail','show run int <int> | inc ospf'],
           eos: ['show ip ospf neighbor detail','show run interfaces <int>'],
           junos:['show ospf neighbor detail','show ospf interface'],
           sonic:['vtysh -c "show ip ospf neighbor detail"'] }},

  { id:'OSPF-02', cat:'Routing', symptom:'OSPF DR election causing instability on broadcast segment',
    causes:['Multiple routers competing for DR','No explicit priority set','BDR taking over on failure'],
    fix:'Set priority on intended DR: "ip ospf priority 255". Use P2P mode on links without DR need.',
    cmds:{ nxos:['show ip ospf neighbors','show run int <int> | inc ospf priority'],
           eos: ['show ip ospf neighbor','show run interfaces <int>'],
           junos:['show ospf neighbor','show ospf interface'],
           sonic:['vtysh -c "show ip ospf neighbor"'] }},

  { id:'OSPF-03', cat:'Routing', symptom:'OSPF type-5 LSA not entering stub/NSSA area',
    causes:['Area configured as stub — no external LSAs allowed','ASBR not in area boundary'],
    fix:'Use NSSA instead of stub if external routes needed. Add "area X nssa" with redistribution.',
    cmds:{ nxos:['show ip ospf database external','show run | inc area'],
           eos: ['show ip ospf database external','show run | section router ospf'],
           junos:['show ospf database external','show ospf overview'],
           sonic:['vtysh -c "show ip ospf database external"'] }},

  // ── IS-IS ────────────────────────────────────────────────────────────────────
  { id:'ISIS-01', cat:'Routing', symptom:'IS-IS adjacency not forming',
    causes:['Area address mismatch','System ID collision','IS-type mismatch (L1 vs L2)'],
    fix:'Verify area address identical. Check system IDs unique. Match IS-type on both ends.',
    cmds:{ nxos:['show isis adjacency','show run | inc router isis','show isis interface'],
           eos: ['show isis neighbors','show run | section router isis'],
           junos:['show isis adjacency','show isis interface'],
           sonic:['vtysh -c "show isis neighbor"'] }},

  { id:'ISIS-02', cat:'Routing', symptom:'IS-IS metric preventing optimal path selection',
    causes:['Wide metrics not enabled','Default narrow metric (63) too coarse for traffic engineering'],
    fix:'Enable wide metrics: "metric-style wide". Tune interface metrics for desired traffic path.',
    cmds:{ nxos:['show isis route','show run | inc metric'],
           eos: ['show isis routes','show run | section router isis'],
           junos:['show isis route','show isis overview'],
           sonic:['vtysh -c "show isis route"'] }},

  // ── VRF ──────────────────────────────────────────────────────────────────────
  { id:'VRF-01', cat:'Routing', symptom:'VRF table not populated — routes missing in VRF',
    causes:['Interface not assigned to VRF','BGP VRF AF not configured','Redistribution missing in VRF'],
    fix:'Verify "vrf member <name>" on SVI. Add BGP VRF address-family. Configure redistribution.',
    cmds:{ nxos:['show vrf','show ip route vrf <name>','show run vrf <name>'],
           eos: ['show vrf <name>','show ip route vrf <name>'],
           junos:['show route table <vrf>.inet.0'],
           sonic:['ip vrf exec <name> ip route show'] }},

  { id:'VRF-02', cat:'Routing', symptom:'Inter-VRF leaking — route in wrong VRF',
    causes:['RT import catching unintended routes','Misconfigured RT values','Overlapping RT range'],
    fix:'Audit RT import/export values. Use unique RT ranges per VRF. Remove accidental imports.',
    cmds:{ nxos:['show run vrf | inc route-target','show ip route vrf <name>'],
           eos: ['show run | section vrf'],
           junos:['show route table <vrf>.inet.0'],
           sonic:['vtysh -c "show bgp vrf <name>"'] }},

  // ── IPv6 ─────────────────────────────────────────────────────────────────────
  { id:'IPV6-01', cat:'Routing', symptom:'IPv6 link-local not auto-configured on interface',
    causes:['IPv6 not enabled on interface','Dad failure on link-local','Interface down'],
    fix:'Enable IPv6: "ipv6 address autoconfig" or "ipv6 enable". Verify no DAD collision.',
    cmds:{ nxos:['show ipv6 interface <int>','show run int <int> | inc ipv6'],
           eos: ['show ipv6 interface <int>','show run interfaces <int>'],
           junos:['show interfaces <int> inet6'],
           sonic:['ip -6 addr show <int>'] }},

  { id:'IPV6-02', cat:'Routing', symptom:'BGP IPv6 AFI not activating — no IPv6 routes in BGP',
    causes:['IPv6 unicast AF not configured under neighbor','Neighbor not activated for IPv6'],
    fix:'Add "address-family ipv6 unicast" under BGP neighbor with "activate".',
    cmds:{ nxos:['show bgp ipv6 unicast summary','show run bgp | inc ipv6'],
           eos: ['show bgp ipv6 unicast summary','show run | section router bgp'],
           junos:['show bgp summary','show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bgp ipv6 unicast summary"'] }},

  // ── Syslog / Logging ──────────────────────────────────────────────────────────
  { id:'LOG-01', cat:'NTP', symptom:'Syslog messages not reaching syslog server',
    causes:['Syslog server IP unreachable','Wrong VRF for syslog','UDP/514 blocked by ACL'],
    fix:'Verify syslog server reachable. Specify management VRF. Allow UDP/514.',
    cmds:{ nxos:['show run | inc logging server','ping <syslog-server> vrf management'],
           eos: ['show run | section logging','show ip route <syslog-ip>'],
           junos:['show configuration system syslog'],
           sonic:['rsyslogd -N1','ss -ulnp | grep 514'] }},

  { id:'LOG-02', cat:'NTP', symptom:'Log buffer full — messages being dropped',
    causes:['Log rate too high (debug mode left on)','Buffer too small','Syslog server not receiving'],
    fix:'Disable debug logging. Increase buffer size. Confirm syslog server receiving.',
    cmds:{ nxos:['show logging | inc buffer','show run | inc logging level'],
           eos: ['show logging | head','show run | section logging'],
           junos:['show log messages | tail'],
           sonic:['journalctl --disk-usage','dmesg | tail -20'] }},

  // ── SNMP ─────────────────────────────────────────────────────────────────────
  { id:'SNMP-01', cat:'Security', symptom:'SNMP polling failing — no response to get-request',
    causes:['Wrong community string / credentials','SNMP not enabled','ACL blocking UDP/161'],
    fix:'Verify community string / SNMPv3 user. Enable SNMP. Allow UDP/161 in ACL.',
    cmds:{ nxos:['show snmp','show run | inc snmp-server community'],
           eos: ['show snmp','show management access-list'],
           junos:['show snmp statistics','show configuration snmp'],
           sonic:['snmpget -v2c -c public <ip> sysDescr.0'] }},

  { id:'SNMP-02', cat:'Security', symptom:'SNMP trap not being sent to NMS',
    causes:['Trap host not configured','Wrong trap community','NMS IP unreachable'],
    fix:'Add trap host: "snmp-server host <nms-ip> traps version 2c <community>". Verify routing.',
    cmds:{ nxos:['show snmp trap','show run | inc snmp-server host'],
           eos: ['show run | section snmp-server'],
           junos:['show snmp statistics','show configuration snmp'],
           sonic:['cat /etc/snmp/snmpd.conf | grep trap'] }},

  // ── Redundancy / HA ──────────────────────────────────────────────────────────
  { id:'HA-01', cat:'Routing', symptom:'HSRP/VRRP gateway not failing over on link failure',
    causes:['Tracking object not configured','Priority not high enough','Preempt not enabled'],
    fix:'Configure tracking: "track 1 interface <uplink> line-protocol". Enable preempt.',
    cmds:{ nxos:['show hsrp all','show run | inc hsrp'],
           eos: ['show vrrp detail','show run | section interface'],
           junos:['show vrrp','show vrrp detail'],
           sonic:['vtysh -c "show vrrp"'] }},

  { id:'HA-02', cat:'Routing', symptom:'vPC peer-link STP loop after one switch reboot',
    causes:['vPC peer-link not carrying native VLAN','LACP fast timer mismatch','vPC consistency check failure'],
    fix:'Verify vPC consistency checks pass: "show vpc consistency-parameters". Check peer-link VLANs.',
    cmds:{ nxos:['show vpc','show vpc consistency-parameters','show vpc peer-keepalive'],
           eos: ['show mlag detail','show mlag interfaces'],
           junos:['show virtual-chassis'],
           sonic:['teamdctl team0 state'] }},

  { id:'HA-03', cat:'Routing', symptom:'MLAG split-brain — both switches acting as primary',
    causes:['Peer-link down','Keepalive link failed','LACP PDU loss on member ports'],
    fix:'Restore peer-link. Check keepalive via dedicated OOB link. Do not share peer-link with data.',
    cmds:{ nxos:['show vpc role','show vpc peer-keepalive'],
           eos: ['show mlag detail','show mlag config-sanity'],
           junos:['show virtual-chassis status'],
           sonic:['teamdctl team0 state'] }},

  // ── WAN / SD-WAN ─────────────────────────────────────────────────────────────
  { id:'WAN-01', cat:'Routing', symptom:'WAN circuit packet loss not detected by BGP hold timer',
    causes:['BGP hold timer 180s — tolerates 3-min packet loss','BFD not enabled on WAN'],
    fix:'Enable BFD on WAN BGP sessions. Set timers to wan_standard (10/30) at minimum.',
    cmds:{ nxos:['show bfd neighbors','show bgp neighbors <ip> | inc timer'],
           eos: ['show bfd peers','show bgp neighbors <ip> | grep timer'],
           junos:['show bfd session','show bgp neighbor <ip>'],
           sonic:['vtysh -c "show bfd peers"'] }},

  { id:'WAN-02', cat:'Routing', symptom:'Asymmetric routing over dual WAN circuits',
    causes:['BGP local-preference not set','MEDs not used to influence inbound','AS-path prepending not configured'],
    fix:'Set local-preference for outbound preference. Use AS-path prepend to influence inbound.',
    cmds:{ nxos:['show ip route','show bgp <prefix>','show run bgp | inc local-preference'],
           eos: ['show bgp <prefix> detail','show run | section route-map'],
           junos:['show route <prefix> detail','show bgp summary'],
           sonic:['vtysh -c "show bgp <prefix> detail"'] }},

  // ── VLAN ─────────────────────────────────────────────────────────────────────
  { id:'VLAN-01', cat:'Interface', symptom:'VLAN not active — status shows "suspended" or "act/unsup"',
    causes:['VTP pruning removing VLAN','VLAN not created on VTP server','STP blocking all ports in VLAN'],
    fix:'Create VLAN: "vlan <id> / name <name>". Check VTP status. Verify STP for this VLAN.',
    cmds:{ nxos:['show vlan','show vlan id <id>','show spanning-tree vlan <id>'],
           eos: ['show vlan','show spanning-tree vlan <id>'],
           junos:['show vlans <id>'],
           sonic:['bridge vlan show'] }},

  { id:'VLAN-02', cat:'Interface', symptom:'Native VLAN mismatch causing STP issues on trunk',
    causes:['Native VLAN different on trunk endpoints','CDP/LLDP native VLAN mismatch warning'],
    fix:'Set matching native VLAN on both trunk ends. Use "switchport trunk native vlan <id>".',
    cmds:{ nxos:['show interface <int> trunk','show cdp neighbors detail | inc native'],
           eos: ['show interfaces <int> trunk'],
           junos:['show interfaces <int> detail | match native'],
           sonic:['bridge vlan show dev <int>'] }},

  // ── Platform-specific ────────────────────────────────────────────────────────
  { id:'PLT-01', cat:'CPU', symptom:'NX-OS ISSU/upgrade causing BGP session drop',
    causes:['Non-disruptive upgrade not enabled','BGP graceful restart not negotiated','iBGP carrying traffic paths'],
    fix:'Enable NSF/GR before ISSU. Verify peer supports GR. Test in maintenance window.',
    cmds:{ nxos:['show install all status','show bgp neighbors | inc graceful','show version'],
           eos: ['show bgp summary','show version'],
           junos:['show bgp summary'],
           sonic:['sonic-installer list'] }},

  { id:'PLT-02', cat:'CPU', symptom:'Arista EOS agent crash causing control-plane interruption',
    causes:['Memory leak in agent','Incompatible EOS version with linecard','High-priority process crash'],
    fix:'Check "show agent logs <agent>". Restart agent if needed. Review EOS errata.',
    cmds:{ nxos:['show system internal sysmgr service all'],
           eos: ['show agent logs','show version','bash sudo cat /var/log/agents/<agent>'],
           junos:['show system processes'],
           sonic:['systemctl list-units | grep failed'] }},

  { id:'BGP-21', cat:'BGP', symptom:'BGP aggregate route not suppressing more-specific prefixes',
    causes:['Missing "summary-only" keyword','as-set causing attribute discrepancy','Route-map condition not met'],
    fix:'Add "summary-only" to aggregate-address. Verify summary mask encompasses all components.',
    cmds:{ nxos:['show bgp <aggregate>','show run bgp | inc aggregate'],
           eos: ['show bgp <aggregate>','show run | section router bgp'],
           junos:['show route <aggregate>','show bgp summary'],
           sonic:['vtysh -c "show bgp <aggregate>"'] }},

  { id:'INT-14', cat:'Interface', symptom:'Interface output rate not matching expected throughput',
    causes:['Traffic shaping limiting output','Queue scheduling unfair','Bandwidth statement incorrect'],
    fix:'Check "show interface <int> | inc rate". Verify no shaping. Check policy-map output queue.',
    cmds:{ nxos:['show interface <int> counters rate','show policy-map interface <int>'],
           eos: ['show interfaces <int> counters rates','show policy-map interface <int>'],
           junos:['show interfaces <int> detail','show class-of-service interface <int>'],
           sonic:['ethtool -S <int>','tc -s qdisc show dev <int>'] }},

  { id:'DHCP-07', cat:'DHCP', symptom:'DHCP lease renewing too frequently causing network churn',
    causes:['Lease time too short (default 1 day is fine)','Client sending DHCPREQUEST aggressively','DHCP server timeout'],
    fix:'Increase lease time to 24h or longer for stable endpoints. Check server health.',
    cmds:{ nxos:['show ip dhcp pool','show ip dhcp binding | count'],
           eos: ['show ip dhcp pool','show ip dhcp server statistics'],
           junos:['show dhcp server binding'],
           sonic:['cat /var/lib/dhcpd/dhcpd.leases | head -50'] }},

  { id:'QOS-09', cat:'QoS', symptom:'Service-policy causing all traffic to be marked DSCP 0',
    causes:['Default class in policy marking everything','Wrong class-map matching all traffic'],
    fix:'Verify class-map match conditions. Default class should only apply to unclassified traffic.',
    cmds:{ nxos:['show policy-map','show policy-map interface <int>'],
           eos: ['show policy-map','show policy-map interface <int>'],
           junos:['show class-of-service forwarding-class'],
           sonic:['tc filter show dev <int>'] }},

  { id:'STP-09', cat:'STP', symptom:'PortFast not taking effect on access port',
    causes:['PortFast not globally enabled','Override at interface level missing','Port connected to switch'],
    fix:'Enable globally: "spanning-tree portfast default". Do not enable on uplinks.',
    cmds:{ nxos:['show spanning-tree summary | inc portfast','show run int <int> | inc portfast'],
           eos: ['show spanning-tree summary','show run interfaces <int>'],
           junos:['show spanning-tree interface <int>'],
           sonic:['mstpctl showport <br> <int>'] }},

  { id:'EVP-16', cat:'EVPN', symptom:'EVPN control plane up but data plane forwarding broken',
    causes:['NVE tunnel programmed but hardware entry missing','VLAN-VNI mapping not in hardware','Software FIB not synced to hardware'],
    fix:'Check "show system internal forwarding consistency". Verify hardware FIB matches EVPN table.',
    cmds:{ nxos:['show forwarding consistency-checker','show hardware internal forwarding'],
           eos: ['show bgp evpn route-type','show platform trident'],
           junos:['show evpn database','show route forwarding-table'],
           sonic:['sonic-cli show platform summary'] }},

  { id:'SEC-07', cat:'Security', symptom:'Management plane lockout after ACL misconfiguration',
    causes:['ACL applied in wrong direction','SSH source IP not permitted in ACL','Implicit deny hit'],
    fix:'Access via console. Remove or fix ACL. Use safe-mode testing: apply with short timeout.',
    cmds:{ nxos:['show ip access-list','show run int mgmt0'],
           eos: ['show management access-list','show run section management'],
           junos:['show firewall filter','show interfaces fxp0'],
           sonic:['iptables -L -n','ip tables-restore < /dev/null'] }},

  { id:'LLDP-06', cat:'LLDP', symptom:'LLDP advertisements stopping after software upgrade',
    causes:['LLDP timer reset after upgrade','Interface LLDP disable not preserved','Config not saved'],
    fix:'Re-enable LLDP globally. Verify startup config has LLDP enabled. Save config.',
    cmds:{ nxos:['show lldp','show feature | inc lldp','show run | inc lldp'],
           eos: ['show lldp','show run | grep lldp'],
           junos:['show lldp statistics'],
           sonic:['lldpctl show statistics'] }},

  { id:'VXL-08', cat:'VXLAN', symptom:'VXLAN traffic experiencing increased latency on spine',
    causes:['ECMP hash sending all VXLAN to one uplink','Spine buffer congestion','MTU black-hole causing retransmits'],
    fix:'Verify ECMP hashing includes UDP src port (entropy). Check spine buffer counters.',
    cmds:{ nxos:['show hardware internal buffer info pkt-stats','show queuing interface <int>'],
           eos: ['show platform trident queue-monitor','show interfaces counters rates'],
           junos:['show class-of-service interface <int>'],
           sonic:['ethtool -S <int>'] }},

  { id:'RTE-11', cat:'Routing', symptom:'Route flap dampening preventing fast convergence',
    causes:['Dampening enabled with aggressive suppress','Physical link instability triggering suppress'],
    fix:'Disable dampening for internal routes. Fix the underlying physical instability first.',
    cmds:{ nxos:['show bgp <prefix>','show run bgp | inc dampening'],
           eos: ['show bgp <prefix> detail | grep damp'],
           junos:['show bgp damping parameters','show route <prefix> detail'],
           sonic:['vtysh -c "show bgp <prefix>"'] }},

];


// ── Classifier engine ─────────────────────────────────────────────────────────

var CATEGORIES = ['All','BGP','EVPN','STP','DHCP','QoS','Interface','CPU','LLDP',
                  'VXLAN','Routing','Multicast','Security','RoCEv2','ZTP','NTP'];

function _matchScore(entry, query) {
  var q = query.toLowerCase();
  var words = q.split(/\s+/).filter(Boolean);
  var score = 0;

  // Exact substring in symptom ranks highest
  if (entry.symptom.toLowerCase().indexOf(q) !== -1) score += 6;
  if (entry.cat.toLowerCase().indexOf(q) !== -1)     score += 4;
  if (entry.id.toLowerCase().indexOf(q) !== -1)      score += 4;
  entry.causes.forEach(function(c) { if (c.toLowerCase().indexOf(q) !== -1) score += 2; });
  if (entry.fix.toLowerCase().indexOf(q) !== -1)     score += 2;

  // Per-word matching for multi-word queries
  if (words.length > 1) {
    words.forEach(function(w) {
      if (entry.symptom.toLowerCase().indexOf(w) !== -1) score += 2;
      if (entry.cat.toLowerCase().indexOf(w) !== -1)     score += 1;
      entry.causes.forEach(function(c) { if (c.toLowerCase().indexOf(w) !== -1) score += 1; });
      if (entry.fix.toLowerCase().indexOf(w) !== -1)     score += 1;
    });
  }
  return score;
}

window.classifySymptom = function(query, category) {
  var results = SYMPTOM_DB.filter(function(e) {
    if (category && category !== 'All' && e.cat !== category) return false;
    if (!query || !query.trim()) return true;
    return _matchScore(e, query.trim()) > 0;
  });
  if (query && query.trim()) {
    results.sort(function(a, b) {
      return _matchScore(b, query.trim()) - _matchScore(a, query.trim());
    });
  }
  return results;
};

window.renderSymptomClassifier = function(query, category) {
  var results = window.classifySymptom(query, category);
  if (!results.length) {
    return '<p class="empty-state">No matching symptoms found. Try different keywords.</p>';
  }

  var html = '<p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">'
           + results.length + ' result' + (results.length !== 1 ? 's' : '') + '</p>';

  results.forEach(function(e) {
    var cmdHtml = '';
    var platforms = ['nxos','eos','junos','sonic'];
    var platformLabels = { nxos:'NX-OS', eos:'Arista EOS', junos:'JunOS', sonic:'SONiC' };
    platforms.forEach(function(p) {
      if (e.cmds && e.cmds[p] && e.cmds[p].length) {
        cmdHtml += '<div style="margin-top:6px;">'
                 + '<span class="platform-badge">' + platformLabels[p] + '</span>'
                 + '<code style="font-size:11px;display:block;margin-top:4px;white-space:pre-wrap;">'
                 + e.cmds[p].join('\n') + '</code></div>';
      }
    });

    var causesHtml = e.causes.map(function(c) {
      return '<li>' + c + '</li>';
    }).join('');

    html += '<div class="symptom-card">'
          + '<div class="symptom-header">'
          + '<span class="symptom-id">' + e.id + '</span>'
          + '<span class="symptom-cat">' + e.cat + '</span>'
          + '<span class="symptom-title">' + e.symptom + '</span>'
          + '</div>'
          + '<div class="symptom-body">'
          + '<div class="symptom-causes"><strong>Likely causes:</strong><ul>' + causesHtml + '</ul></div>'
          + '<div class="symptom-fix"><strong>Fix:</strong> ' + e.fix + '</div>'
          + '<div class="symptom-cmds"><strong>Diagnostic commands:</strong>' + cmdHtml + '</div>'
          + '</div>'
          + '</div>';
  });
  return html;
};

window.SYMPTOM_DB = SYMPTOM_DB;
window.SYMPTOM_CATEGORIES = CATEGORIES;
