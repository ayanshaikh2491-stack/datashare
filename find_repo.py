import urllib.request
import json

def search(q):
    req = urllib.request.Request(
        f"https://api.github.com/search/repositories?q={q}",
        headers={"User-Agent": "jcode"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}

def user_repos(user):
    req = urllib.request.Request(
        f"https://api.github.com/users/{user}/repos?per_page=100",
        headers={"User-Agent": "jcode"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}

# Search
for q in ["callstck", "agentic-device", "agenctic"]:
    print(f"=== Search: {q} ===")
    data = search(q)
    if "error" in data:
        print(f"  ERROR: {data['error']}")
    else:
        items = data.get("items") or []
        for item in items[:8]:
            desc = item.get("description") or ""
            print(f"  {item['full_name']} - {desc[:60]}")
    print()

# Check user
print("=== User: callstck ===")
repos = user_repos("callstck")
if "error" in repos:
    print(f"  ERROR: {repos['error']}")
else:
    for r in repos[:20]:
        print(f"  {r['full_name']}")
