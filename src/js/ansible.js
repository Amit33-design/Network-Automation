'use strict';

/* ════════════════════════════════════════════════════════════════
   ANSIBLE PLAYBOOK GENERATOR (#13)
   Generates site.yml + inventory/hosts.yml + host_vars/<host>.yml
   for pushing NetDesign AI configs via NAPALM/netconf.

   genAnsiblePlaybook(state)  → { files: [ {name, content} ] }
   downloadAnsiblePlaybook()  → triggers browser download of each file
                                 (downloads as individual files)
════════════════════════════════════════════════════════════════ */

/* Map platform string → napalm driver + ansible network_os */
var _PLATFORM_MAP = {
  'ios-xe': { napalm: 'ios',       network_os: 'cisco.ios.ios',     conn: 'network_cli' },
  'nxos':   { napalm: 'nxos_ssh', network_os: 'cisco.nxos.nxos',   conn: 'network_cli' },
  'eos':    { napalm: 'eos',       network_os: 'arista.eos.eos',    conn: 'network_cli' },
  'junos':  { napalm: 'junos',     network_os: 'junipernetworks.junos.junos', conn: 'netconf' },
  'sonic':  { napalm: 'sonic',     network_os: 'community.network.nos.sonic', conn: 'network_cli' },
};

function _guessPlatform(layer) {
  if (!layer) return 'ios-xe';
  if (layer.includes('gpu-spine')) return 'eos';
  if (layer.includes('gpu-tor'))   return 'sonic';
  if (layer.includes('dc'))        return 'nxos';
  return 'ios-xe';
}

function _indent(n, str) {
  var pad = Array(n + 1).join(' ');
  return str.split('\n').map(function(l) { return l ? pad + l : ''; }).join('\n');
}

function genAnsiblePlaybook(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var devices = [];
  try {
    if (typeof buildDeviceList === 'function') devices = buildDeviceList();
  } catch(e) {}

  var today = new Date().toISOString().slice(0, 10);
  var orgSlug = (s.orgName || 'netdesign').toLowerCase().replace(/[^a-z0-9]/g, '-');
  var files = [];

  /* ── Group devices by platform ─────────────────────────────── */
  var groups = {};
  devices.forEach(function(dev) {
    var plat = _guessPlatform(dev.layer);
    if (!groups[plat]) groups[plat] = [];
    groups[plat].push(dev);
  });

  /* ── inventory/hosts.yml ────────────────────────────────────── */
  var hostsYml = [
    '# NetDesign AI — Ansible Inventory',
    '# Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A'),
    '# Edit the ansible_host IPs before running.',
    'all:',
    '  vars:',
    '    ansible_user: admin',
    '    ansible_password: "{{ vault_ansible_password }}"',
    '    ansible_become: yes',
    '    ansible_become_method: enable',
    '    config_dir: "{{ playbook_dir }}/configs"',
    '  children:',
  ];

  Object.keys(groups).forEach(function(plat) {
    var pm = _PLATFORM_MAP[plat] || _PLATFORM_MAP['ios-xe'];
    hostsYml.push('    ' + plat + ':');
    hostsYml.push('      vars:');
    hostsYml.push('        ansible_network_os: ' + pm.network_os);
    hostsYml.push('        ansible_connection: ' + pm.conn);
    hostsYml.push('      hosts:');
    groups[plat].forEach(function(dev, i) {
      var ip = '10.0.0.' + (50 + i);
      hostsYml.push('        ' + dev.name + ':');
      hostsYml.push('          ansible_host: ' + ip + '  # TODO: replace with real IP');
    });
  });

  files.push({ name: 'inventory/hosts.yml', content: hostsYml.join('\n') });

  /* ── ansible.cfg ────────────────────────────────────────────── */
  files.push({
    name: 'ansible.cfg',
    content: [
      '[defaults]',
      'inventory      = inventory/hosts.yml',
      'roles_path     = roles',
      'host_key_checking = False',
      'timeout        = 30',
      'forks          = 10',
      'gathering      = smart',
      'fact_caching   = jsonfile',
      'fact_caching_connection = /tmp/ansible_facts_cache',
      'fact_caching_timeout = 3600',
      '',
      '[persistent_connection]',
      'connect_timeout = 30',
      'command_timeout = 30',
      '',
      '[ssh_connection]',
      'ssh_args = -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null',
    ].join('\n'),
  });

  /* ── requirements.yml (collections) ────────────────────────── */
  files.push({
    name: 'requirements.yml',
    content: [
      '---',
      '# Install with:  ansible-galaxy collection install -r requirements.yml',
      'collections:',
      '  - name: cisco.ios',
      '    version: ">=5.0.0"',
      '  - name: cisco.nxos',
      '    version: ">=5.0.0"',
      '  - name: arista.eos',
      '    version: ">=6.0.0"',
      '  - name: junipernetworks.junos',
      '    version: ">=5.0.0"',
      '  - name: ansible.netcommon',
      '    version: ">=5.0.0"',
      '',
      '# Python dependencies (pip install):',
      '#   napalm>=4.1.0  paramiko  netmiko  ncclient',
    ].join('\n'),
  });

  /* ── site.yml ───────────────────────────────────────────────── */
  files.push({
    name: 'site.yml',
    content: [
      '---',
      '# NetDesign AI — Site-wide playbook',
      '# Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A'),
      '#',
      '# Usage:',
      '#   ansible-playbook site.yml                      # all devices',
      '#   ansible-playbook site.yml --limit ios-xe       # vendor group only',
      '#   ansible-playbook site.yml --limit NYC-LEAF-A01-01  # single device',
      '#   ansible-playbook site.yml --tags validate      # dry-run checks only',
      '#   ansible-playbook site.yml --check              # Ansible check mode',
      '',
      '- name: Deploy NetDesign AI generated configs',
      '  hosts: all',
      '  gather_facts: false',
      '  serial: 1  # Push one device at a time; set to 10 for parallel',
      '',
      '  pre_tasks:',
      '    - name: Verify connectivity',
      '      ansible.netcommon.net_ping:',
      '      tags: [always, validate]',
      '',
      '  roles:',
      '    - role: common      # NTP, SNMP, AAA — applied to all devices',
      '      tags: [common]',
      '    - role: push_config # Push vendor-specific config file',
      '      tags: [config, deploy]',
      '    - role: validate    # Post-push verification',
      '      tags: [validate]',
      '',
      '  post_tasks:',
      '    - name: Save running config',
      '      ansible.netcommon.cli_command:',
      '        command: write memory',
      '      when: ansible_network_os is search("ios|nxos|eos")',
      '      tags: [deploy]',
    ].join('\n'),
  });

  /* ── roles/common/tasks/main.yml ────────────────────────────── */
  files.push({
    name: 'roles/common/tasks/main.yml',
    content: [
      '---',
      '# Common tasks applied to every device (NTP, SNMP v3, logging)',
      '',
      '- name: Configure NTP servers',
      '  ansible.netcommon.cli_config:',
      '    config: "{{ lookup(\'template\', \'../templates/ntp_\' + ansible_network_os.split(\'.\')[-1] + \'.j2\') }}"',
      '  tags: [ntp]',
      '',
      '- name: Configure SNMP v3',
      '  ansible.netcommon.cli_config:',
      '    config: "{{ lookup(\'template\', \'../templates/snmp_\' + ansible_network_os.split(\'.\')[-1] + \'.j2\') }}"',
      '  tags: [snmp]',
      '',
      '- name: Configure syslog',
      '  ansible.netcommon.cli_config:',
      '    config: "{{ lookup(\'template\', \'../templates/logging_\' + ansible_network_os.split(\'.\')[-1] + \'.j2\') }}"',
      '  tags: [logging]',
    ].join('\n'),
  });

  /* ── roles/push_config/tasks/main.yml ──────────────────────── */
  files.push({
    name: 'roles/push_config/tasks/main.yml',
    content: [
      '---',
      '# Push the per-device generated config file from NetDesign AI',
      '',
      '- name: Check config file exists',
      '  ansible.builtin.stat:',
      '    path: "{{ config_dir }}/{{ inventory_hostname }}.txt"',
      '  register: cfg_stat',
      '  delegate_to: localhost',
      '',
      '- name: Fail if config file missing',
      '  ansible.builtin.fail:',
      '    msg: "Config file not found: {{ config_dir }}/{{ inventory_hostname }}.txt"',
      '  when: not cfg_stat.stat.exists',
      '',
      '- name: Push config (IOS / NX-OS / EOS)',
      '  ansible.netcommon.cli_config:',
      '    config: "{{ lookup(\'file\', config_dir + \'/\' + inventory_hostname + \'.txt\') }}"',
      '    diff_against: running',
      '    diff_ignore_lines:',
      '      - "^Building configuration"',
      '      - "^Current configuration"',
      '  when: ansible_connection == "network_cli"',
      '  register: push_result',
      '',
      '- name: Push config (Junos via NETCONF)',
      '  junipernetworks.junos.junos_config:',
      '    src: "{{ config_dir }}/{{ inventory_hostname }}.txt"',
      '    src_format: text',
      '    update: merge',
      '    commit: yes',
      '  when: ansible_connection == "netconf"',
      '  register: junos_push_result',
      '',
      '- name: Show diff',
      '  ansible.builtin.debug:',
      '    var: push_result.diff',
      '  when: push_result.diff is defined',
    ].join('\n'),
  });

  /* ── roles/validate/tasks/main.yml ─────────────────────────── */
  files.push({
    name: 'roles/validate/tasks/main.yml',
    content: [
      '---',
      '# Post-push validation checks',
      '',
      '- name: Check interfaces are up',
      '  ansible.netcommon.cli_command:',
      '    command: show interfaces status',
      '  register: intf_status',
      '',
      '- name: Fail if uplink interfaces are down',
      '  ansible.builtin.fail:',
      '    msg: "Uplink interface {{ item }} appears to be down!"',
      '  loop: "{{ expected_uplinks | default([]) }}"',
      '  when: item not in intf_status.stdout and intf_status.stdout is defined',
      '',
      '- name: Check BGP neighbors (IOS-XE / NX-OS)',
      '  ansible.netcommon.cli_command:',
      '    command: show bgp summary',
      '  register: bgp_summary',
      '  when: ansible_network_os is search("ios|nxos")',
      '',
      '- name: Check BGP neighbors (EOS)',
      '  ansible.netcommon.cli_command:',
      '    command: show bgp summary',
      '  register: bgp_summary_eos',
      '  when: ansible_network_os is search("eos")',
      '',
      '- name: Validate LLDP neighbors',
      '  ansible.netcommon.cli_command:',
      '    command: show lldp neighbors',
      '  register: lldp_neighbors',
      '',
      '- name: Save validation output',
      '  ansible.builtin.copy:',
      '    content: |',
      '      === {{ inventory_hostname }} Validation Report ===',
      '      Date: {{ ansible_date_time.iso8601 | default(\'unknown\') }}',
      '      --- BGP ---',
      '      {{ bgp_summary.stdout | default(bgp_summary_eos.stdout | default(\'N/A\')) }}',
      '      --- LLDP ---',
      '      {{ lldp_neighbors.stdout | default(\'N/A\') }}',
      '    dest: "reports/{{ inventory_hostname }}-validation.txt"',
      '  delegate_to: localhost',
      '  ignore_errors: yes',
    ].join('\n'),
  });

  /* ── host_vars per device ───────────────────────────────────── */
  devices.forEach(function(dev) {
    var plat = _guessPlatform(dev.layer);
    var pm = _PLATFORM_MAP[plat] || _PLATFORM_MAP['ios-xe'];
    files.push({
      name: 'host_vars/' + dev.name + '.yml',
      content: [
        '---',
        '# Host variables for ' + dev.name,
        'device_hostname: ' + dev.name,
        'device_layer: ' + dev.layer,
        'device_platform: ' + plat,
        'napalm_driver: ' + pm.napalm,
        '# expected_uplinks:  # Uncomment and list uplink interfaces for validation',
        '#   - Ethernet1',
        '#   - Ethernet2',
      ].join('\n'),
    });
  });

  /* ── README ─────────────────────────────────────────────────── */
  files.push({
    name: 'README.md',
    content: [
      '# NetDesign AI — Ansible Deployment',
      '',
      'Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A'),
      '',
      '## Quick Start',
      '',
      '```bash',
      '# 1. Install collections and Python deps',
      'ansible-galaxy collection install -r requirements.yml',
      'pip install napalm netmiko paramiko ncclient',
      '',
      '# 2. Create vault for credentials',
      'ansible-vault create group_vars/all/vault.yml',
      '# Add:  vault_ansible_password: <your-password>',
      '',
      '# 3. Copy generated configs into ./configs/',
      '#    One file per device: configs/NYC-LEAF-A01-01.txt',
      '',
      '# 4. Update inventory/hosts.yml with real IPs',
      '',
      '# 5. Dry run (check mode)',
      'ansible-playbook site.yml --check --diff',
      '',
      '# 6. Deploy',
      'ansible-playbook site.yml',
      '```',
      '',
      '## Directory Structure',
      '',
      '```',
      '├── site.yml              Main playbook',
      '├── ansible.cfg           Ansible settings',
      '├── requirements.yml      Collection dependencies',
      '├── inventory/',
      '│   └── hosts.yml         Device inventory',
      '├── host_vars/            Per-device variables',
      '├── group_vars/all/',
      '│   └── vault.yml         Encrypted credentials (create with ansible-vault)',
      '├── roles/',
      '│   ├── common/           NTP, SNMP, logging',
      '│   ├── push_config/      Config push + diff',
      '│   └── validate/         Post-push checks',
      '├── configs/              Generated config files (copy from NetDesign AI)',
      '└── reports/              Validation reports (auto-created)',
      '```',
    ].join('\n'),
  });

  return files;
}

/* ── Download all files individually ─────────────────────────── */
function downloadAnsiblePlaybook() {
  var s = typeof STATE !== 'undefined' ? STATE : {};
  var files = genAnsiblePlaybook(s);
  if (!files || !files.length) {
    if (typeof toast === 'function') toast('No devices in design yet — complete Step 3 first', 'warn');
    return;
  }

  /* Download each file with a slight delay so browsers don't block multiple downloads */
  files.forEach(function(f, i) {
    setTimeout(function() {
      var blob = new Blob([f.content], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      /* Flatten path: inventory/hosts.yml → inventory_hosts.yml */
      a.download = 'ansible_' + f.name.replace(/\//g, '_').replace(/^_/, '');
      a.click();
    }, i * 120);
  });

  if (typeof toast === 'function') {
    toast('Ansible playbook downloaded (' + files.length + ' files)', 'success');
  }
}

window.genAnsiblePlaybook      = genAnsiblePlaybook;
window.downloadAnsiblePlaybook = downloadAnsiblePlaybook;
