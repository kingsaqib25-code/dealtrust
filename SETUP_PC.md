# Apne PC par Partnership Portal Chalane ka Tarika

## Pehle ye 2 cheezein tayar karo

1. **Node.js** — nodejs.org se LTS version download karke install karo. (Version 20 ya us se zyada)
2. **Free database** — neon.tech par free account banao, "New Project" banao, aur wahan se **connection string** copy kar lo. Tumhe apne PC par kuch install nahi karna parega.

## Phir ye steps follow karo

1. Is zip file ko extract karo aur folder kholo.
2. `.env.example` file ko **copy** karke usi folder me `.env` naam se paste karo.
3. `.env` file Notepad me kholo aur ye 3 cheezein set karo:
   - `DATABASE_URL="..."` — neon wali connection string quotes ke andar paste karo
   - `JWT_SECRET="..."` — koi lambi random string likh do (kam az kam 32 characters), masalan: `meri-secret-key-12345-abcde-67890-fghij`
   - `NEXT_PUBLIC_APP_URL="http://localhost:3000"`
   - Baqi sab (email, Stripe waghera) khaali chhor do, unki zaroorat nahi.
4. Us folder me terminal kholo (Windows me folder ke andar right-click → "Open in Terminal"), phir ek ek karke ye commands chalao:
   - `npm install` — pehli dafa 3-5 minute lagega, ghabrana nahi
   - `npx prisma db push` — database me tables ban jayenge
   - `npx tsx scripts/seed.ts` — admin user ban jayega
   - `npm run dev` — server start ho jayega
5. Browser me kholo: **http://localhost:3000**
   - Email: `admin@example.com`
   - Password: `password`

## Kaam ke pages

- `/admin` — tumhara admin panel (sab kuch yahan se control hoga)
- `/partner` — partner company ka portal
- `/affiliate` — referrer ka portal

## Zaroori note

`admin@example.com` sirf shuru ke liye hai. Login ke baad profile me ja kar apna naam aur password zaroor badal lena. Aur jab asal partner company add karni ho to admin panel me "Partner Companies" se add karna.
