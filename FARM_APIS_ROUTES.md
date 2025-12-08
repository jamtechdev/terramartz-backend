# Farm Related APIs - Complete Routes & Usage

## Base URL
```
/api/farms
/api/seller
/api/terramartz/sellers
```

---

## 1. 🔍 Search Farms (Public)
**Route:** `GET /api/farms/search`

**Description:** Search farms with filters (location, products, categories, etc.)

**Authentication:** Not required

**Query Parameters:**
```javascript
{
  // Farm filters
  farmName: "Fresh Farm",              // Farm business name
  name: "Farm",                        // Farm description search
  farmStatus: "active,featured",       // Comma-separated: active, inactive, featured, pending
  certifications: "organic,usda",      // Comma-separated certifications
  
  // Location filters
  latitude: 43.6532,                   // User's latitude
  longitude: -79.3832,                 // User's longitude
  distance: 10,                        // Distance in km
  
  // Seller/Business filters
  city: "Toronto",
  state: "Ontario",
  postalCode: "M5H",
  country: "Canada",
  
  // Product filters
  productName: "Tomato",               // Product title search
  productCategory: "category-id",      // Category ID
  delivery: "today",                   // today/tomorrow/custom
  
  // Pagination
  page: 1,                             // Default: 1
  limit: 10                            // Default: 10
}
```

**Response:**
```json
{
  "success": true,
  "pagination": {
    "totalFarms": 50,
    "totalPages": 5,
    "currentPage": 1
  },
  "summary": {
    "localFarms": 50,
    "freshProducts": 200,
    "avgDistance": "5.2 km"
  },
  "farms": [
    {
      "_id": "farm-id",
      "description": "Fresh Farm Produce",
      "farm_status": "active",
      "certifications": ["organic"],
      "product_categories": ["vegetables"],
      "location": {
        "type": "Point",
        "coordinates": [-79.3832, 43.6532]
      },
      "distanceFromUser": 5200,
      "ownerData": {
        "_id": "seller-id",
        "businessDetails": {
          "businessName": "Fresh Farm",
          "city": "Toronto"
        }
      },
      "productCount": 10,
      "products": [...]
    }
  ]
}
```

---

## 2. 📦 Get Farm Products (Public)
**Route:** `GET /api/farms/:farmId/products`

**Description:** Get all products of a specific farm

**Authentication:** Not required

**URL Parameters:**
- `farmId` - Farm ID

**Response:**
```json
{
  "success": true,
  "farm": {
    "_id": "farm-id",
    "description": "Fresh Farm Produce",
    "farm_status": "active",
    "certifications": ["organic"],
    "product_categories": ["vegetables"],
    "location": {
      "type": "Point",
      "coordinates": [-79.3832, 43.6532]
    },
    "owner": {
      "_id": "seller-id",
      "businessDetails": {...}
    },
    "products": [
      {
        "_id": "product-id",
        "title": "Organic Tomatoes",
        "description": "...",
        "price": 5.99,
        "stockQuantity": 100,
        "productType": "fresh",
        "category": "category-id",
        "performance": {
          "views": 1000,
          "sales": 50
        }
      }
    ]
  }
}
```

---

## 3. ⚙️ Update Shop Settings + Farm Settings (Seller Only)
**Route:** `PATCH /api/seller/shop-settings`

**Description:** Update seller shop settings, business details, and farm information

**Authentication:** Required (Bearer Token)

**Content-Type:** `multipart/form-data`

**Request Body:**
```javascript
{
  // Shop Settings
  shippingCharges: 5.99,
  freeShippingThreshold: 50.00,
  promoCodes: [
    {
      code: "SAVE10",
      discount: 10,
      expiresAt: "2025-12-31",
      minOrderAmount: 25,
      type: "percentage"  // or "fixed"
    }
  ],
  
  // Business Details
  businessDetails: {
    businessName: "Fresh Farm Produce",
    businessLocation: "123 Farm Road",
    numberOfEmployees: 10,
    licenseNumber: "LIC123456",
    city: "Toronto",
    state: "Ontario",
    postalCode: "M5H 2N2",
    country: "Canada"
  },
  
  // Seller Profile
  sellerProfile: {
    shopName: "Fresh Farm Shop",
    shopSlug: "fresh-farm-shop"
    // Note: shopId cannot be updated
  },
  
  // Farm Settings
  description: "We grow fresh organic vegetables",
  location: {
    type: "Point",
    coordinates: [-79.3832, 43.6532]  // [longitude, latitude]
  },
  distanceRange: 25,  // km
  certifications: ["organic", "usda"],
  product_categories: ["vegetables", "fruits"],
  farm_status: "active",  // active, inactive, featured, pending
  openingHours: {
    open: "08:00",
    close: "18:00"
  },
  
  // Files (optional)
  shopPicture: File,      // Image file
  profilePicture: File    // Image file
}
```

**Response:**
```json
{
  "status": "success",
  "sellerProfile": {
    "shopId": "shop-abc123",
    "shopName": "Fresh Farm Shop",
    "shopPicture": "shop-1234567890-abc.jpeg",
    "shippingCharges": 5.99,
    "freeShippingThreshold": 50.00
  },
  "businessDetails": {
    "businessName": "Fresh Farm Produce",
    "city": "Toronto"
  },
  "profilePicture": "profile-1234567890-xyz.jpeg",
  "farm": {
    "_id": "farm-id",
    "description": "We grow fresh organic vegetables",
    "location": {
      "type": "Point",
      "coordinates": [-79.3832, 43.6532]
    },
    "farm_status": "active",
    "certifications": ["organic", "usda"],
    "product_categories": ["vegetables", "fruits"]
  }
}
```

---

## 4. 🏪 Get Seller Store Details (Public)
**Route:** `GET /api/terramartz/sellers/:sellerId/store`

**Description:** Get seller store information including farm details

**Authentication:** Not required

**URL Parameters:**
- `sellerId` - Seller User ID

**Response:**
```json
{
  "success": true,
  "store": {
    "sellerId": "seller-id",
    "shopName": "Fresh Farm Shop",
    "shopPicture": "shop-abc.jpeg",
    "farmDescription": "We grow fresh organic vegetables",
    "specialties": ["vegetables", "fruits"],
    "certifications": ["organic"],
    "location": {
      "type": "Point",
      "coordinates": [-79.3832, 43.6532]
    },
    "openingHours": {
      "open": "08:00",
      "close": "18:00"
    },
    "totalProducts": 50,
    "averageRating": 4.5,
    "totalReviews": 100
  }
}
```

---

## 5. 🛒 Get Seller Store Products (Public)
**Route:** `GET /api/terramartz/sellers/:sellerId/store/products`

**Description:** Get all products from a seller's store

**Authentication:** Not required

**URL Parameters:**
- `sellerId` - Seller User ID

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "_id": "product-id",
      "title": "Organic Tomatoes",
      "price": 5.99,
      "stockQuantity": 100,
      // ... other product fields
    }
  ]
}
```

---

## 6. ➕ Farm Auto-Creation (During Signup)
**Route:** `POST /api/users/signup`

**Description:** When seller signs up with `role: "seller"` and `accountType: "business"`, farm is automatically created

**Note:** Farm is created automatically, no separate API needed

**Farm Created With:**
- `owner`: Seller's user ID
- `description`: Business name
- `location`: Default [0, 0]
- `farm_status`: "pending"
- `product_categories`: []
- `certifications`: []
- `products`: []

---

## Summary Table

| API Route | Method | Auth | Purpose |
|-----------|--------|------|---------|
| `/api/farms/search` | GET | No | Search farms with filters |
| `/api/farms/:farmId/products` | GET | No | Get farm products |
| `/api/seller/shop-settings` | PATCH | Yes | Update shop + farm settings |
| `/api/terramartz/sellers/:sellerId/store` | GET | No | Get seller store details |
| `/api/terramartz/sellers/:sellerId/store/products` | GET | No | Get seller products |
| `/api/users/signup` | POST | No | Signup (auto-creates farm) |

---

## Important Notes:

1. **Farm Creation:** Farm is automatically created during seller signup (business account only)
2. **Farm Update:** Use `/api/seller/shop-settings` to update farm details
3. **Location Format:** Always use `[longitude, latitude]` for coordinates
4. **Farm Status:** Can be `active`, `inactive`, `featured`, or `pending`
5. **Products:** Products are automatically linked to farm when seller creates them



