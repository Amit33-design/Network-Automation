"""
Policy generators — all network policy blocks.

Exported generators (all take ctx: dict, platform: str → str):
  generate_bgp_policy     — BGP route-maps, prefix-lists, communities
  generate_acl            — iACL, VLAN ACLs, anti-spoof, VTY restriction
  generate_dot1x          — 802.1X / IBNS 2.0, RADIUS, CoA, MAB
  generate_qos            — class-maps, queuing, PFC/ECN
  generate_aaa            — TACACS+, SNMPv3, Syslog, NTP auth
  generate_static_routing — default routes, floating statics, discard agg
  generate_vlan_policy    — VLAN DB, STP priorities, VACLs, PVLAN, SVIs
  generate_trunk_policy   — LACP port-channels, allowed VLANs, storm ctrl
  generate_wireless_policy— SSID, 802.1X/OWE, RF profiles, band steering
"""
from .bgp_policy       import generate_bgp_policy
from .acl              import generate_acl
from .dot1x            import generate_dot1x
from .qos_policy       import generate_qos
from .aaa_policy       import generate_aaa
from .static_routing   import generate_static_routing
from .vlan_policy      import generate_vlan_policy
from .trunk_policy     import generate_trunk_policy
from .wireless_policy  import generate_wireless_policy

__all__ = [
    "generate_bgp_policy",
    "generate_acl",
    "generate_dot1x",
    "generate_qos",
    "generate_aaa",
    "generate_static_routing",
    "generate_vlan_policy",
    "generate_trunk_policy",
    "generate_wireless_policy",
]
