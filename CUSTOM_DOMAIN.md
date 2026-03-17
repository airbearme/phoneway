# Custom Domain Setup: vercel.phoneway.app

## Prerequisites
- You must own the domain `phoneway.app`
- Access to your domain's DNS settings

## Step 1: Add Domain in Vercel

1. Go to https://vercel.com/dashboard
2. Select the **phoneway** project
3. Go to **Settings** → **Domains**
4. Enter: `vercel.phoneway.app`
5. Click **Add**

## Step 2: Configure DNS

In your domain registrar's DNS settings, add this CNAME record:

```
Type:    CNAME
Name:    vercel
Value:   cname.vercel-dns.com
TTL:     3600
```

## Step 3: Verify

Wait 5-30 minutes for DNS to propagate, then visit:
**https://vercel.phoneway.app**

## Alternative: Root Domain (phoneway.app)

If you want just `phoneway.app` (without subdomain):

```
Type:    A
Name:    @
Value:   76.76.21.21
TTL:     3600
```

Or use Vercel's nameservers:
```
ns1.vercel-dns.com
ns2.vercel-dns.com
```

## Current Deployment

While setting up DNS, the app is live at:
**https://phoneway-rouge.vercel.app**

## SSL Certificate

Vercel automatically provisions SSL certificates for custom domains.
