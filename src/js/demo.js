'use strict';

function loadDemo(ucKey) {
  // Clear existing
  localStorage.removeItem(LS_KEY);
  document.querySelectorAll('.use-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.industry-chip').forEach(c => c.classList.remove('on'));
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  document.querySelectorAll('.proto-card').forEach(c => c.classList.remove('on'));
  document.querySelectorAll('.vendor-chip').forEach(c => c.classList.remove('on'));

  const demos = {
    dc: {
      uc:'dc', industry:'technology', orgName:'Acme Cloud Corp', orgSize:'large',
      numSites:'2', redundancy:'ha', traffic:'ew', totalHosts:'800',
      bwPerServer:'25g', oversub:3, fwModel:'perimeter',
      vpnType:'ztna', latencySla:'low', automation:'ansible',
      underlayProto:['BGP'], overlayProto:['VXLAN / EVPN'],
      protoFeatures:['IPv6 Dual-Stack','BFD Fast Failover','ECMP Load Balancing','Anycast Gateway','VRF / Tenant separation'],
      compliance:['SOC 2'], nac:['DHCP snooping','Dynamic ARP inspection'],
      appTypes:['Web / HTTP(S)','Database (SQL/NoSQL)','Object Storage (S3 / Ceph)','Kubernetes / containers'],
      gpuSpecifics:[], extraNotes:'Multi-tenant DC fabric for cloud workloads. VXLAN EVPN with BGP spine-leaf.',
      // Phase 2
      budget:'enterprise', preferredVendors:['Cisco'], numSitesTopology:3,
    },
    gpu: {
      uc:'gpu', industry:'technology', orgName:'AI Research Lab', orgSize:'enterprise',
      numSites:'1', redundancy:'full', traffic:'ew', totalHosts:'128',
      bwPerServer:'400g', oversub:1, fwModel:'perimeter',
      vpnType:'ztna', latencySla:'ultra', automation:'netconf',
      underlayProto:['BGP'], overlayProto:['None'],
      protoFeatures:['ECMP Load Balancing','BFD Fast Failover'],
      compliance:[], nac:['DHCP snooping'],
      appTypes:['AI / ML training','HPC / MPI','Object Storage (S3 / Ceph)'],
      gpuSpecifics:['RoCEv2 (Ethernet)','Priority Flow Control (PFC)','ECN / DCQCN','Rail-optimized topology'],
      extraNotes:'H100 GPU cluster — 16 racks × 8 GPUs. Rail-optimized RoCEv2 fabric with SHARP.',
      // Phase 2
      budget:'hyperscale', preferredVendors:['Arista','NVIDIA'], numSitesTopology:3,
    },
    campus: {
      uc:'campus', industry:'education', orgName:'State University', orgSize:'large',
      numSites:'4', redundancy:'ha', traffic:'ns', totalHosts:'5000',
      bwPerServer:'1g', oversub:8, fwModel:'perimeter',
      vpnType:'ssl', latencySla:'best-effort', automation:'ansible',
      underlayProto:['OSPF'], overlayProto:['None'],
      protoFeatures:['IPv6 Dual-Stack','Multicast (PIM-SM)','QoS / DSCP','VRF / Tenant separation'],
      compliance:[], nac:['802.1X (wired)','802.1X (wireless)','MAB fallback','DHCP snooping','Dynamic ARP inspection'],
      appTypes:['Web / HTTP(S)','Voice / UC','Video streaming'],
      gpuSpecifics:[], extraNotes:'Multi-building university campus with 4 buildings. 802.1X NAC with ISE.',
      // Phase 2
      budget:'mid', preferredVendors:['Cisco'], numSitesTopology:3,
    },
    // NEW: Fortinet-centric SMB campus demo
    fortinet: {
      uc:'campus', industry:'retail', orgName:'Regional Retailer Group', orgSize:'medium',
      numSites:'3', redundancy:'basic', traffic:'ns', totalHosts:'250',
      bwPerServer:'1g', oversub:5, fwModel:'perimeter',
      vpnType:'ssl', latencySla:'best-effort', automation:'ansible',
      underlayProto:['OSPF'], overlayProto:['None'],
      protoFeatures:['QoS / DSCP','VRF / Tenant separation'],
      compliance:['PCI-DSS'], nac:['802.1X (wired)','802.1X (wireless)','DHCP snooping'],
      appTypes:['Web / HTTP(S)','VoIP / SIP'],
      gpuSpecifics:[], extraNotes:'FortiGate + FortiSwitch Security Fabric. Managed via single-pane FortiManager.',
      // Phase 2
      budget:'smb', preferredVendors:['Fortinet'], numSitesTopology:3,
    },
    // NEW: Multi-site DC / DCI demo
    multisite: {
      uc:'multisite', industry:'finance', orgName:'Global Finance Corp', orgSize:'enterprise',
      numSites:'4', redundancy:'full', traffic:'ew', totalHosts:'1200',
      bwPerServer:'100g', oversub:2, fwModel:'distributed',
      vpnType:'ztna', latencySla:'low', automation:'ansible',
      underlayProto:['BGP','IS-IS'], overlayProto:['VXLAN / EVPN','MPLS'],
      protoFeatures:['BFD Fast Failover','ECMP Load Balancing','Anycast Gateway','VRF / Tenant separation','IPv6 Dual-Stack'],
      compliance:['PCI-DSS','SOC 2'], nac:['DHCP snooping','Dynamic ARP inspection'],
      appTypes:['Web / HTTP(S)','Database (SQL/NoSQL)','Kubernetes / containers'],
      gpuSpecifics:[], extraNotes:'Four geographically distributed DCs: DCA Primary, DCB Active-Active, DCC DR, DCD Edge PoP.',
      // Phase 2
      budget:'enterprise', preferredVendors:['Cisco','Arista'], numSitesTopology:4,
    },
  };

  const d = demos[ucKey] || demos.dc;
  Object.assign(STATE, d, { step: STATE.step, selectedProducts: {} });

  // Apply to DOM
  document.querySelectorAll('.use-card').forEach(c => {
    if (c.dataset.uc === d.uc) c.classList.add('selected');
  });
  document.querySelectorAll('.industry-chip').forEach(c => {
    if (c.dataset.val === d.industry) c.classList.add('on');
  });

  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  setVal('org-name', d.orgName); setVal('org-size', d.orgSize);
  setVal('num-sites', d.numSites); setVal('redundancy', d.redundancy);
  setVal('total-hosts', d.totalHosts); setVal('bw-per-server', d.bwPerServer);
  setVal('fw-model', d.fwModel); setVal('vpn-type', d.vpnType);
  setVal('latency-sla', d.latencySla); setVal('automation', d.automation);
  setVal('extra-notes', d.extraNotes);
  // Phase 2: budget + vendors
  setVal('budget-tier', d.budget || '');
  document.querySelectorAll('.vendor-chip').forEach(c => {
    c.classList.toggle('on', (d.preferredVendors || []).includes(c.dataset.vendor));
  });

  const sl = document.getElementById('oversub');
  if (sl) { sl.value = d.oversub; document.getElementById('oversub-val').textContent = d.oversub + ':1'; }

  const chipMap = {
    'underlay-proto': d.underlayProto, 'overlay-proto': d.overlayProto,
    'compliance': d.compliance, 'nac': d.nac,
    'app-types': d.appTypes, 'gpu-specifics': d.gpuSpecifics,
  };
  Object.entries(chipMap).forEach(([id, vals]) => {
    document.querySelectorAll(`#${id} .chip`).forEach(c => {
      c.classList.toggle('on', vals.includes(c.textContent.trim()));
    });
  });
  document.querySelectorAll('.proto-card').forEach(c => {
    c.classList.toggle('on', d.protoFeatures.includes(c.textContent.trim()));
  });
  const trIdx = { ns:0, ew:1, both:2 }[d.traffic] ?? 0;
  document.querySelectorAll('.seg-btn').forEach((b,i) => b.classList.toggle('active', i === trIdx));

  updateSummary();
  closeDemoModal();
  toast(`Demo loaded: ${d.orgName} — click Continue to see the full design`, 'success', 5000);
}

/* ── Demo modal ─────────────────────────────────────────────────── */
function openDemoModal() {
  document.getElementById('demo-modal').classList.add('open');
}
function closeDemoModal() {
  document.getElementById('demo-modal').classList.remove('open');
}
