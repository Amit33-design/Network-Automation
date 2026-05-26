import { useNavigate } from 'react-router-dom';
import { useIntentStore } from '@/store/intentStore';
import type { UseCaseType } from '@/types/intent';

const USE_CASES: { id: UseCaseType; label: string; icon: string; desc: string }[] = [
  { id: 'campus', label: 'Campus / Enterprise LAN', icon: '🏢', desc: 'Access-distribution-core, 802.1X, VoIP, wireless LAN' },
  { id: 'dc_fabric', label: 'Data Center Leaf-Spine', icon: '🗄️', desc: 'VXLAN/EVPN, BGP underlay, anycast gateway, high-density' },
  { id: 'gpu_cluster', label: 'AI / GPU Cluster', icon: '🧠', desc: 'RoCEv2, PFC/ECN, RDMA QoS, rail-optimized fabric' },
  { id: 'hybrid', label: 'Hybrid Campus + DC', icon: '🔀', desc: 'DCI interconnect, L2 stretch, EVPN multi-site' },
  { id: 'wan', label: 'WAN / SD-WAN', icon: '🌐', desc: 'vEdge, vSmart, app-aware routing, Zscaler/ZTNA' },
  { id: 'dci', label: 'Multi-Site DCI', icon: '🔗', desc: 'Dark fiber DCI, EVPN multi-site, BFD, ECMP' },
  { id: 'multicloud', label: 'Enterprise → Multicloud', icon: '☁️', desc: 'AWS/Azure/GCP connectivity, Aviatrix, BGP peering' },
  { id: 'sp_mpls', label: 'Service Provider / MPLS', icon: '📡', desc: 'IOS-XR, SR-MPLS, L3VPN, TI-LFA, BGP VPNv4' },
  { id: 'private_5g', label: 'Private 5G / O-RAN', icon: '📶', desc: 'eCPRI fronthaul, PTP timing, SyncE, 5G QoS' },
  { id: 'storage', label: 'Storage Networking', icon: '💾', desc: 'NVMe-oF, FCoE, iSCSI, RoCEv2, MDS SAN fabric' },
];

export function Step1UseCasePage() {
  const { intent, setIntent, setActiveStep } = useIntentStore();
  const navigate = useNavigate();

  function select(id: UseCaseType) {
    setIntent({ use_case: id });
    setActiveStep(2);
    navigate('/bom');
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-2">Select Use Case</h1>
      <p className="text-slate-400 mb-6">Choose the network design scenario that best matches your requirements.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {USE_CASES.map((uc) => (
          <button
            key={uc.id}
            onClick={() => select(uc.id)}
            className={`text-left p-4 rounded-xl border transition-all duration-150 ${
              intent.use_case === uc.id
                ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                : 'border-slate-700 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800'
            }`}
          >
            <div className="text-2xl mb-2">{uc.icon}</div>
            <div className="font-medium text-white text-sm">{uc.label}</div>
            <div className="text-slate-400 text-xs mt-1">{uc.desc}</div>
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => { setActiveStep(2); navigate('/bom'); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
