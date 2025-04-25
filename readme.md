# Shopify Product Tagger

A Node.js script to automatically tag products in your Shopify store based on a CSV input file.

## Features
- Tags products based on CSV input
- Handles special characters in product titles
- Generates reports of successfully tagged and not-found products
- Rate limiting to respect Shopify's API limits
- Detailed logging

## Setup
1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your Shopify credentials:
   ```env
   SHOPIFY_SHOP_NAME=your-shop-name
   SHOPIFY_ACCESS_TOKEN=your-access-token
   ```

## Usage
1. Place your CSV file in the `intake` folder
2. The CSV should have these columns:
   - Product title
   - Product vendor
   - Product type
3. Run the script:
   ```bash
   node product-tagger.js
   ```

## Output
The script generates two CSV reports in the `intake` folder:
- `tagged_products_YYYY-MM-DD_HH-MM.csv`: Successfully tagged products
- `not_found_products_YYYY-MM-DD_HH-MM.csv`: Products that couldn't be found

Both reports include:
- gid (Shopify Product ID)
- title
- productType
- vendor

## Requirements
- Node.js 14 or higher
- Shopify Admin API access with:
  - `read_products` scope
  - `write_products` scope

## Notes
- The script uses rate limiting to respect Shopify's API limits
- All times in filenames are in Eastern timezone
- Special characters in product titles (-, &, ., etc.) are handled automatically