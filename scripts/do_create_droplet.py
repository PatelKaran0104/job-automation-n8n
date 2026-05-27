#!/usr/bin/env python3
"""
DigitalOcean Droplet Creation Script for Karan Patel
=====================================================
Creates a $12/month Ubuntu 22.04 droplet in Frankfurt with a cloud firewall
that opens ports 22 (SSH), 3000 (resume server), and 5678 (n8n).

Setup:
  pip install requests
  Get token: DigitalOcean Console → API → Generate New Token (read + write scope)
  Windows: set DO_TOKEN=your_token_here
  Linux:   export DO_TOKEN=your_token_here
  Run:     python do_create_droplet.py
"""

import os
import sys
import time
import requests
import datetime

# ─── Config ───────────────────────────────────────────────────────────────────
# Paste your token here, or set the DO_TOKEN environment variable to override.
# Get it: DigitalOcean Console → API → Personal Access Tokens → Generate New Token (read + write)
DO_TOKEN     = os.environ.get("DO_TOKEN") or "paste-your-token-here"
DROPLET_NAME = "resume-server"
REGION       = "fra1"            # Frankfurt — closest to Germany
SIZE         = "s-1vcpu-2gb"     # 2 GB RAM, 1 vCPU, 50 GB SSD — $12/month
IMAGE        = "ubuntu-22-04-x64"
SSH_KEY_NAME = "resume-server-key"

SSH_PUBLIC_KEY = (
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDbc5GE3hmTZmsQqgVXDhHr3l7mPmrnSstme5LcJTW"
    "cZJWU5VE0RRb/LPAU5aVVzuH/SdHm2iSc9VzM7irVgRGt+SnHJxQGRWlyWsv+qqtsqmUKjt4Y5DPx"
    "lDPnZwM7F/w9YD5YDeRTy7YT2qqAZe2mJS4ddr/BDb100W6N0ByhLVHUSi5RVBHTmsRzgpxz4N1Bfq"
    "kCzjqpPiMEkCnhhAS3YO3YvL44l4cCiPNUrXc/QfBmVdDcKQbmyo9JcNqtn4GntWavrL6mfEFd5Hr3"
    "6D4SGvhNFutIVhEW2ooY+zq1TbtErPY5ZdAOLzgmvMfVSc3FfYvCj8o+5UBwNbjG5hbL5NU2iC+Wrv"
    "b1ICJuJBe2kN0YLxWvwQuUwESLobtB5ynaoM34BgmEunMokzMB4jrLnZ2cQWhO7TcTGiWyGdKR+OSmZ"
    "jx5QeDU2Fh8q1t2V3UjTSMjOg1ZdGIByoCDS/AaxOaZ2i8AEKtcZlGtzd8IhxFUhFEeVAkFARqCNi/"
    "LVInMzARXA0lEh16u8/p53epN+FObVU2XPLANUnT8oUJKTLO19gu4ED1cVJxd823V9rrD8spgzsDs+J"
    "bLMYbo7esCLXEoCkoF4U+X+KXeRZMCsIKQ+3c60ULkmBZMIkE7mSMgE4BBlvpKRrxrLQfND3+V5Se9"
    "NLZjtASAw6apLYmXCw== resume-server"
)

BASE_URL = "https://api.digitalocean.com/v2"


def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def api(method, path, **kwargs):
    headers = {
        "Authorization": f"Bearer {DO_TOKEN}",
        "Content-Type": "application/json",
    }
    resp = requests.request(method, f"{BASE_URL}{path}", headers=headers, **kwargs)
    if not resp.ok:
        print(f"ERROR {resp.status_code} on {method} {path}:")
        print(resp.text)
        sys.exit(1)
    return resp.json() if resp.text else {}


def ensure_ssh_key():
    """Upload SSH key if not already present. Returns the key ID."""
    data = api("GET", "/account/keys")
    for key in data.get("ssh_keys", []):
        if key["name"] == SSH_KEY_NAME or key["public_key"].split()[:2] == SSH_PUBLIC_KEY.split()[:2]:
            log(f"Reusing existing SSH key: {key['name']} (id={key['id']})")
            return key["id"]

    log("Uploading SSH key...")
    result = api("POST", "/account/keys", json={
        "name": SSH_KEY_NAME,
        "public_key": SSH_PUBLIC_KEY,
    })
    key_id = result["ssh_key"]["id"]
    log(f"SSH key uploaded (id={key_id})")
    return key_id


def create_droplet(ssh_key_id):
    """Create the droplet and return its ID."""
    log(f"Creating droplet '{DROPLET_NAME}' in {REGION} ({SIZE})...")
    result = api("POST", "/droplets", json={
        "name":     DROPLET_NAME,
        "region":   REGION,
        "size":     SIZE,
        "image":    IMAGE,
        "ssh_keys": [ssh_key_id],
        "backups":  False,
        "ipv6":     False,
        "tags":     ["resume-server"],
    })
    droplet_id = result["droplet"]["id"]
    log(f"Droplet created (id={droplet_id}). Waiting for active status...")
    return droplet_id


def wait_for_active(droplet_id):
    """Poll until the droplet is active and has a public IP. Returns the IP."""
    for _ in range(30):
        time.sleep(10)
        data = api("GET", f"/droplets/{droplet_id}")
        droplet = data["droplet"]
        if droplet["status"] == "active":
            for net in droplet["networks"].get("v4", []):
                if net["type"] == "public":
                    return net["ip_address"]
        log("  Still provisioning...")
    print("ERROR: Droplet did not become active within 5 minutes.")
    sys.exit(1)


def create_firewall(droplet_id):
    """Create a cloud firewall opening ports 22, 3000, 5678 and attach it to the droplet."""
    log("Creating firewall...")
    anywhere = {"addresses": ["0.0.0.0/0", "::/0"]}
    result = api("POST", "/firewalls", json={
        "name": "resume-server-fw",
        "inbound_rules": [
            {"protocol": "tcp", "ports": "22",   "sources":      anywhere},
            {"protocol": "tcp", "ports": "3000", "sources":      anywhere},
            {"protocol": "tcp", "ports": "5678", "sources":      anywhere},
        ],
        "outbound_rules": [
            {"protocol": "tcp", "ports": "all", "destinations": anywhere},
            {"protocol": "udp", "ports": "all", "destinations": anywhere},
            {"protocol": "icmp",                "destinations": anywhere},
        ],
        "droplet_ids": [droplet_id],
    })
    fw_id = result["firewall"]["id"]
    log(f"Firewall created and attached (id={fw_id})")


def main():
    if not DO_TOKEN:
        print("ERROR: DO_TOKEN environment variable is not set.")
        print("  Windows: set DO_TOKEN=your_token_here")
        print("  Linux:   export DO_TOKEN=your_token_here")
        print("  Get it:  DigitalOcean Console → API → Generate New Token")
        sys.exit(1)

    log("=== DigitalOcean Droplet Creation Script ===")

    ssh_key_id = ensure_ssh_key()
    droplet_id = create_droplet(ssh_key_id)
    public_ip  = wait_for_active(droplet_id)
    create_firewall(droplet_id)

    sep = "=" * 55
    print(f"\n{sep}")
    print("  DROPLET CREATED SUCCESSFULLY!")
    print(f"  Name   : {DROPLET_NAME}")
    print(f"  Region : {REGION} (Frankfurt)")
    print(f"  IP     : {public_ip}")
    print(f"  SSH    : ssh root@{public_ip}")
    print()
    print("  Next steps on the droplet:")
    print("    curl -fsSL https://get.docker.com | sh")
    print(f"    git clone <your-repo> ~/resume-generator")
    print(f"    cd ~/resume-generator && cp .env.example .env")
    print(f"    # Edit .env: set SERVER_URL=http://{public_ip}:3000")
    print(f"    docker compose up -d --build")
    print()
    print(f"  n8n UI : http://{public_ip}:5678")
    print(sep)


if __name__ == "__main__":
    main()
