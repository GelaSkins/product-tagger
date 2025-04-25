/**
 * Shopify Product Tagging Script
 * 
 * This script identifies and tags products based on specified criteria:
 * 1. Top N products by sales (based on actual order data)
 * 2. Products added in the last 12 months
 * 
 * The script also removes tags from products that no longer meet the criteria.
 */

require('dotenv').config();
const { GraphQLClient } = require('graphql-request');
const fs = require('fs');
const csv = require('csv-parse');
const path = require('path');
const { stringify } = require('csv-stringify/sync');

// Load environment variables
const SHOP_NAME = process.env.SHOPIFY_SHOP_NAME;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

if (!SHOP_NAME || !ACCESS_TOKEN) {
  console.error('Error: Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// Configuration
const API_VERSION = '2024-04';
const CSV_FILE_PATH = path.join(__dirname, 'intake', 'best sellers.csv');
const TAG_NAME = 'api-top-seller';
const RATE_LIMIT_DELAY = 500; // ms between API calls

// GraphQL client setup
const client = new GraphQLClient(
  `https://${SHOP_NAME}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
  {
    headers: {
      'X-Shopify-Access-Token': ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
  }
);

// Find product by title, vendor, and type
async function findProduct(title, vendor, productType) {
  const query = `
    query findProduct($searchQuery: String!) {
      products(first: 10, query: $searchQuery) {
        edges {
          node {
            id
            title
            vendor
            productType
            tags
          }
        }
      }
    }
  `;

  // Clean and escape the search terms
  const cleanAndEscape = (str) => {
    return str
      .replace(/'/g, "\\'")  // Escape single quotes
      .replace(/"/g, '\\"')  // Escape double quotes
      .replace(/\\/g, '\\\\')  // Escape backslashes
      .trim();
  };
  
  const cleanTitle = cleanAndEscape(title);
  
  // Start with just the title search first, using exact match
  const searchQuery = `title:"${cleanTitle}"`;  // Using double quotes for exact match
  
  console.log('\nSearching Shopify with query:', searchQuery);

  try {
    const response = await client.request(query, { searchQuery });
    console.log('Search response:', JSON.stringify(response, null, 2));
    
    if (response.products.edges.length > 0) {
      // If we found products, do an exact string comparison
      const matches = response.products.edges.filter(edge => {
        const product = edge.node;
        return (
          product.title === title &&  // Exact title match
          product.vendor.trim() === vendor.trim() &&
          product.productType.trim() === productType.trim()
        );
      });
      
      if (matches.length > 0) {
        const matchedProduct = matches[0].node;
        console.log('Found exact matching product:', JSON.stringify(matchedProduct, null, 2));
        return matchedProduct;
      } else {
        console.log('Found products with similar title but no exact match');
        console.log('Original title:', title);
        console.log('Found titles:', response.products.edges.map(e => e.node.title));
        return null;
      }
    }
    console.log('No matching product found');
    return null;
  } catch (error) {
    console.error(`API Error searching for product:`, error);
    if (error.response?.errors) {
      console.error('GraphQL Errors:', error.response.errors);
    }
    return null;
  }
}

// Update tags for a product
async function updateProductTags(product) {
  console.log('Updating tags for product:', JSON.stringify(product, null, 2));
  
  const query = `
    mutation updateProductTags($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Handle tags as an array (which is what the API returns)
  let currentTags = Array.isArray(product.tags) ? product.tags : [];
  console.log('Current tags (before):', currentTags);
  
  // Add our new tag if it's not already there
  if (!currentTags.includes(TAG_NAME)) {
    currentTags.push(TAG_NAME);
  }
  
  console.log('Updated tags (after):', currentTags);

  const variables = {
    input: {
      id: product.id,
      tags: currentTags
    }
  };

  try {
    const response = await client.request(query, variables);
    console.log('Update response:', JSON.stringify(response, null, 2));
    
    if (response.productUpdate.userErrors.length > 0) {
      throw new Error(response.productUpdate.userErrors.map(e => e.message).join(', '));
    }
    console.log('Successfully updated tags for product:', product.title);
    return true;
  } catch (error) {
    console.error(`Failed to update tags for product ${product.title}: ${error.message}`);
    return false;
  }
}

function generateReports(taggedProducts, notFoundProducts) {
  // Create Eastern timezone date
  const easternTime = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // Format as YYYY-MM-DD_HH-MM
  const [date, time] = easternTime.split(', ');
  const [month, day, year] = date.split('/');
  const [hour, minute] = time.split(':');
  const formattedTimestamp = `${year}-${month}-${day}_${hour}-${minute}`;
  
  // Generate success report
  if (taggedProducts.length > 0) {
    const successPath = path.join(__dirname, 'intake', `tagged_products_${formattedTimestamp}.csv`);
    const successData = taggedProducts.map(product => ({
      gid: product.id.replace('gid://shopify/Product/', ''),
      title: product.title,
      productType: product.productType,
      vendor: product.vendor
    }));

    const successCsv = stringify(successData, {
      header: true,
      columns: {
        gid: 'gid',
        title: 'title',
        productType: 'productType',
        vendor: 'vendor'
      }
    });

    fs.writeFileSync(successPath, successCsv);
    console.log(`\nTagged products report written to: ${successPath}`);
  }

  // Generate not found report
  if (notFoundProducts.length > 0) {
    const notFoundPath = path.join(__dirname, 'intake', `not_found_products_${formattedTimestamp}.csv`);
    const notFoundData = notFoundProducts.map(product => ({
      gid: '',  // Empty GID since product wasn't found
      title: product.title,
      productType: product.productType,
      vendor: product.vendor
    }));

    const notFoundCsv = stringify(notFoundData, {
      header: true,
      columns: {
        gid: 'gid',
        title: 'title',
        productType: 'productType',
        vendor: 'vendor'
      }
    });

    fs.writeFileSync(notFoundPath, notFoundCsv);
    console.log(`Not found products report written to: ${notFoundPath}`);
  }
  
  // Display summary in console
  console.log('\nTagging Summary:');
  console.log('================');
  console.log(`Tag added: ${TAG_NAME}`);
  console.log(`Total products tagged: ${taggedProducts.length}`);
  console.log(`Total products not found: ${notFoundProducts.length}`);
}

// Process the CSV file
async function processTopProducts() {
  console.log('Starting to process top products...');
  console.log(`Reading CSV file from: ${CSV_FILE_PATH}`);
  
  const products = [];
  
  // Read and parse the CSV file
  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv.parse({ 
        columns: true,
        skip_empty_lines: true,
        trim: true
      }))
      .on('data', (row) => {
        // Get the exact key that contains "title"
        const titleKey = Object.keys(row).find(k => k.toLowerCase().includes('title'));
        const vendorKey = Object.keys(row).find(k => k.toLowerCase().includes('vendor'));
        const typeKey = Object.keys(row).find(k => k.toLowerCase().includes('type'));

        console.log('Found keys:', { titleKey, vendorKey, typeKey });

        const title = titleKey ? row[titleKey] : null;
        const vendor = vendorKey ? row[vendorKey] : null;
        const productType = typeKey ? row[typeKey] : null;

        console.log('\nExtracted values using found keys:');
        console.log('Title:', title);
        console.log('Vendor:', vendor);
        console.log('Product Type:', productType);

        if (title && vendor && productType) {
            const product = {
                title: title.trim(),
                vendor: vendor.trim(),
                productType: productType.trim()
            };
            products.push(product);
            console.log('Added product:', product);
        } else {
            console.warn('Skipping row - missing required fields:', {
                hasTitle: Boolean(title),
                hasVendor: Boolean(vendor),
                hasType: Boolean(productType),
                foundKeys: { titleKey, vendorKey, typeKey },
                actualValues: { title, vendor, productType }
            });
        }
      })
      .on('end', () => {
        console.log(`\nFinished reading CSV. Found ${products.length} products.`);
        resolve();
      })
      .on('error', (error) => {
        console.error('Error parsing CSV:', error);
        reject(error);
      });
  });

  if (products.length === 0) {
    console.error('No products found in CSV file. Please check the file format and contents.');
    return;
  }

  // Process each product
  let processed = 0;
  let matched = 0;
  let tagged = 0;
  const successfullyTagged = [];
  const notFound = [];

  for (const product of products) {
    processed++;
    try {
      console.log(`\nProcessing [${processed}/${products.length}]: ${product.title}`);
      
      const shopifyProduct = await findProduct(product.title, product.vendor, product.productType);
      
      if (shopifyProduct) {
        matched++;
        console.log(`Found: ${product.title}`);
        
        const success = await updateProductTags(shopifyProduct);
        if (success) {
          tagged++;
          successfullyTagged.push({
            ...shopifyProduct,
            originalData: product
          });
          console.log(`Tagged: ${product.title}`);
        }
      } else {
        console.log(`Not found: ${product.title}`);
        notFound.push(product);
      }
      
      // Respect rate limits
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      
    } catch (error) {
      console.error(`Error processing ${product.title}: ${error.message}`);
      notFound.push(product);
    }
    
    // Show progress
    console.log(`\nProgress Update:`);
    console.log(`Processed: ${processed}/${products.length}`);
    console.log(`Matched: ${matched}`);
    console.log(`Tagged: ${tagged}`);
  }

  // Generate reports at the end
  generateReports(successfullyTagged, notFound);

  console.log('\nProcessing complete!');
  console.log(`Total products processed: ${processed}`);
  console.log(`Products matched: ${matched}`);
  console.log(`Products tagged: ${tagged}`);
  console.log(`Products not found: ${notFound.length}`);
}

// Run the script
processTopProducts().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});