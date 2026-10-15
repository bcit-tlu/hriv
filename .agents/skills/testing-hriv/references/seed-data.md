## Seed Test Accounts

All use password: `password`

| Email                 | Role       | canEditContent | canManageUsers |
| --------------------- | ---------- | -------------- | -------------- |
| admin@example.ca      | admin      | Yes            | Yes            |
| instructor@example.ca | instructor | Yes            | No             |
| student@example.ca    | student    | No             | No             |

## Seed Data

### Categories (hierarchical)

- Architecture (id=1)
  - American (id=4)
  - Italian (id=3)
    - Gothic (id=5)
- Panoramas (id=2)
- Synthetic Monitoring (id=6)

### Programs

| ID  | Name           |
| --- | -------------- |
| 1   | Administration |
| 2   | Digital Design |
| 3   | Photography    |

### Images

| ID  | Name                            | Category             | Program        | Source                 |
| --- | ------------------------------- | -------------------- | -------------- | ---------------------- |
| 1   | Duomo di Milano                 | Italian              | Digital Design | OpenSeadragon examples |
| 2   | Duomo di Milano (Gothic Detail) | Gothic               | Digital Design | OpenSeadragon examples |
| 3   | Highsmith Panorama              | American             | Photography    | Library of Congress    |
| 4   | Library of Congress             | Panoramas            | Photography    | Library of Congress    |
| 5   | Synthetic Monitoring Image      | Synthetic Monitoring | Administration | local seed asset       |

### Direct Image Counts per Category

These are direct (first-child) counts, not subtree sums:

| Category             | Direct Image Count |
| -------------------- | ------------------ |
| Architecture         | 0                  |
| American             | 1                  |
| Italian              | 1                  |
| Gothic               | 1                  |
| Panoramas            | 1                  |
| Synthetic Monitoring | 1                  |

## Getting an API Auth Token

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1
```
