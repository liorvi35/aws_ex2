const express = require('express');
const RestaurantsMemcachedActions = require('./model/restaurantsMemcachedActions');

const app = express();
app.use(express.json());

const MEMCACHED_CONFIGURATION_ENDPOINT = process.env.MEMCACHED_CONFIGURATION_ENDPOINT;
const TABLE_NAME = process.env.TABLE_NAME;
const AWS_REGION = process.env.AWS_REGION;
const USE_CACHE = process.env.USE_CACHE === 'true';

const memcachedActions = new RestaurantsMemcachedActions(MEMCACHED_CONFIGURATION_ENDPOINT);

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({ region: AWS_REGION });


app.get('/', (req, res) => {
    const response = {
        MEMCACHED_CONFIGURATION_ENDPOINT: MEMCACHED_CONFIGURATION_ENDPOINT,
        TABLE_NAME: TABLE_NAME,
        AWS_REGION: AWS_REGION,
        USE_CACHE: USE_CACHE
    };
    res.send(response);
});


/**
 * Adds a new restaurant to the database.
 * 
 * POST /restaurants
 * 
 * This endpoint expects a JSON body with the following fields:
 * - name: The name of the restaurant (required)
 * - cuisine: The type of cuisine the restaurant offers (required)
 * - region: The geographical region where the restaurant is located (required)
 * - rating: The initial rating of the restaurant (optional, defaults to 0)
 * 
 * If the restaurant already exists, a 409 status code is returned.
 * If any required fields are missing, a 400 status code is returned.
 * If the operation is successful, a 200 status code is returned.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
app.post('/restaurants', async (req, res) => {
    const restaurant = req.body;

    // Check for missing required fields
    if (!restaurant.name || !restaurant.cuisine || !restaurant.region) {
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    const getParams = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurant.name
        }
    };

    if (USE_CACHE) {
        try {
            // Check the cache for existing restaurant
            const cachedRestaurant = await memcachedActions.getRestaurants(restaurant.name);
            if (cachedRestaurant) {
                res.status(409).send({ success: false, message: 'Restaurant already exists' });
                return;
            }
        } catch (cacheError) {
            console.error('Error accessing memcached:', cacheError);
        }
    } else {
        try {
            // Check the database for existing restaurant
            const data = await dynamodb.get(getParams).promise();

            if (data.Item) {
                res.status(409).send({ success: false, message: 'Restaurant already exists' });
                return;
            }

        } catch (err) {
            console.error('POST /restaurants', err);
            res.status(500).send("Internal Server Error");
            return;
        }
    }

    const params = {
        TableName: TABLE_NAME,
        Item: {
            SimpleKey: restaurant.name,
            Cuisine: restaurant.cuisine,
            GeoRegion: restaurant.region,
            Rating: restaurant.rating || 0,
            RatingCount: 0
        }
    };

    try {
        // Add the new restaurant to the database
        await dynamodb.put(params).promise();

        if (USE_CACHE) {
            const cacheKeysToInvalidate = [];

            // Generate cache keys to invalidate
            for (let limit = 10; limit <= 100; limit += 1) {
                cacheKeysToInvalidate.push(`${restaurant.region}_limit_${limit}`);
                cacheKeysToInvalidate.push(`${restaurant.region}_${restaurant.cuisine}_limit_${limit}`);

                for (let minRating = 0; minRating <= 5; minRating += 0.1) {
                    cacheKeysToInvalidate.push(`${restaurant.cuisine}_minRating_${minRating}_limit_${limit}`);
                }
            }

            try {
                // Invalidate cache keys
                const deletePromises = cacheKeysToInvalidate.map(key => memcachedActions.deleteRestaurants(key).catch(err => {
                    if (err.cmdTokens && err.cmdTokens[0] === 'NOT_FOUND') {
                        // Cache key not found, ignoring.
                    } else {
                        throw err;
                    }
                }));
                await Promise.all(deletePromises);
                // Cache invalidated for the generated keys
            } catch (cacheError) {
                console.error('Error invalidating memcached:', cacheError);
            }

            try {
                // Add the new restaurant to the cache
                await memcachedActions.addRestaurants(restaurant.name, restaurant);
                // Added to cache
            } catch (cacheError) {
                console.error('Error adding to memcached:', cacheError);
            }
        }

        res.status(200).send({ success: true });
    } catch (err) {
        console.error('POST /restaurants', err);
        res.status(500).send("Internal Server Error");
    }
});


/**
 * Retrieves details of a restaurant by its name.
 * 
 * GET /restaurants/:restaurantName
 * 
 * This endpoint expects a URL parameter with the name of the restaurant.
 * 
 * If the restaurant is not found, a 404 status code is returned.
 * If the operation is successful, a 200 status code is returned along with the restaurant details.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
app.get('/restaurants/:restaurantName', async (req, res) => {
    const restaurantName = req.params.restaurantName;

    if (USE_CACHE) {
        try {
            // Check the cache for the restaurant
            const cachedRestaurant = await memcachedActions.getRestaurants(restaurantName);
            if (cachedRestaurant) {
                cachedRestaurant.rating = parseFloat(cachedRestaurant.rating) || 0;
                res.status(200).send(cachedRestaurant);
                return;
            }
        } catch (cacheError) {
            console.error('Error accessing memcached:', cacheError);
        }
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Attempt to retrieve the restaurant from the database
        const data = await dynamodb.get(params).promise();

        if (!data.Item) {
            res.status(404).send({ message: 'Restaurant not found' });
            return;
        }

        // Parse the restaurant data
        const restaurant = {
            name: data.Item.SimpleKey,
            cuisine: data.Item.Cuisine,
            rating: data.Item.Rating || 0,
            region: data.Item.GeoRegion
        };

        if (USE_CACHE) {
            try {
                restaurant.rating = restaurant.rating.toString();
                // Add the restaurant to the cache
                await memcachedActions.addRestaurants(restaurantName, restaurant);
            } catch (cacheError) {
                console.error('Error adding to memcached:', cacheError);
            }
        }

        // Send the restaurant details as the response
        res.status(200).send(restaurant);
    } catch (err) {
        console.error('GET /restaurants/:restaurantName', err);
        res.status(500).send('Internal Server Error');
    }
});


/**
 * Deletes a restaurant by its name.
 * 
 * DELETE /restaurants/:restaurantName
 * 
 * This endpoint expects a URL parameter with the name of the restaurant.
 * 
 * If the restaurant is not found, a 404 status code is returned.
 * If the operation is successful, a 200 status code is returned with a success message.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
app.delete('/restaurants/:restaurantName', async (req, res) => {
    const restaurantName = req.params.restaurantName;

    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Attempt to retrieve the restaurant from the database
        const data = await dynamodb.get(params).promise();

        if (!data.Item) {
            res.status(404).send({ message: 'Restaurant not found' });
            return;
        }

        if (USE_CACHE) {
            try {
                // Invalidate the cache for the restaurant
                await memcachedActions.deleteRestaurants(restaurantName);
                //console.log('Cache invalidated for:', restaurantName);
            } catch (cacheError) {
                console.error('Error invalidating memcached:', cacheError);
            }

            try {
                const cacheKeysToInvalidate = [];

                // Generate cache keys to invalidate
                for (let limit = 10; limit <= 100; limit += 1) {
                    cacheKeysToInvalidate.push(`${data.Item.region}_limit_${limit}`);
                    cacheKeysToInvalidate.push(`${data.Item.region}_${data.Item.cuisine}_limit_${limit}`);

                    for (let minRating = 0; minRating <= 5; minRating += 0.1) {
                        cacheKeysToInvalidate.push(`${data.Item.cuisine}_minRating_${minRating}_limit_${limit}`);
                    }
                }

                try {
                    // Invalidate the generated cache keys
                    const deletePromises = cacheKeysToInvalidate.map(key => memcachedActions.deleteRestaurants(key).catch(err => {
                        if (err.cmdTokens && err.cmdTokens[0] === 'NOT_FOUND') {
                            // Cache key not found, ignoring.
                        } else {
                            throw err;
                        }
                    }));
                    await Promise.all(deletePromises);
                    // Cache invalidated for the generated keys
                } catch (cacheError) {
                    console.error('Error invalidating memcached:', cacheError);
                }

            } catch (cacheError) {
                console.error('Error invalidating memcached:', cacheError);
            }
        }

        // Delete the restaurant from the database
        await dynamodb.delete(params).promise();
        console.log('Restaurant', restaurantName, 'deleted successfully');
        res.status(200).send({ success: true });
    } catch (err) {
        console.error('DELETE /restaurants/:restaurantName', err);
        res.status(500).send('Internal Server Error');
    }
});


/**
 * Adds a rating to a restaurant and calculates the average rating.
 * 
 * POST /restaurants/rating
 * 
 * This endpoint expects a JSON body with the following fields:
 * - name: The name of the restaurant (required)
 * - rating: The new rating to be added (required)
 * 
 * If any required fields are missing, a 400 status code is returned.
 * If the restaurant is not found, a 404 status code is returned.
 * If the operation is successful, a 200 status code is returned with a success message.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
app.post('/restaurants/rating', async (req, res) => {
    const restaurantName = req.body.name;
    const newRating = req.body.rating;

    // Check for missing required fields
    if (!restaurantName || !newRating) {
        console.error('POST /restaurants/rating', 'Missing required fields');
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Retrieve the restaurant data from the database
        const data = await dynamodb.get(params).promise();

        if (!data.Item) {
            res.status(404).send("Restaurant not found");
            return;
        }

        // Calculate the new average rating
        const oldRating = data.Item.Rating || 0;
        const ratingCount = data.Item.RatingCount || 0;
        const newAverageRating = ((oldRating * ratingCount) + newRating) / (ratingCount + 1);

        // Update the restaurant's rating in the database
        const updateParams = {
            TableName: TABLE_NAME,
            Key: {
                SimpleKey: restaurantName
            },
            UpdateExpression: 'set Rating = :r, RatingCount = :rc',
            ExpressionAttributeValues: {
                ':r': newAverageRating,
                ':rc': ratingCount + 1
            }
        };

        await dynamodb.update(updateParams).promise();

        if (USE_CACHE) {
            try {
                // Update the cache with the new rating
                await memcachedActions.addRestaurants(restaurantName, {
                    name: restaurantName,
                    cuisine: data.Item.Cuisine,
                    rating: newAverageRating.toString(),
                    region: data.Item.GeoRegion
                });

                const cacheKeysToInvalidate = [];

                // Generate cache keys to invalidate
                for (let limit = 10; limit <= 100; limit += 1) {
                    cacheKeysToInvalidate.push(`${data.Item.region}_limit_${limit}`);
                    cacheKeysToInvalidate.push(`${data.Item.region}_${data.Item.cuisine}_limit_${limit}`);

                    for (let minRating = 0; minRating <= 5; minRating += 0.1) {
                        cacheKeysToInvalidate.push(`${data.Item.cuisine}_minRating_${minRating}_limit_${limit}`);
                    }
                }

                try {
                    // Invalidate the generated cache keys
                    const deletePromises = cacheKeysToInvalidate.map(key => memcachedActions.deleteRestaurants(key).catch(err => {
                        if (err.cmdTokens && err.cmdTokens[0] === 'NOT_FOUND') {
                            // Cache key not found, ignoring.
                        } else {
                            throw err;
                        }
                    }));
                    await Promise.all(deletePromises);
                    // Cache invalidated for the generated keys
                } catch (cacheError) {
                    console.error('Error invalidating memcached:', cacheError);
                }

            } catch (cacheError) {
                console.error('Error invalidating memcached:', cacheError);
            }
        }

        res.status(200).send({ success: true });
    } catch (error) {
        console.error('POST /restaurants/rating', error);
        res.status(500).send("Internal Server Error");
    }
});


/**
 * Retrieves top-rated restaurants by cuisine.
 * 
 * GET /restaurants/cuisine/:cuisine
 * 
 * This endpoint expects a URL parameter with the type of cuisine.
 * It supports an optional query parameter 'limit' to limit the number of results (default 10, max 100).
 * It also supports an optional query parameter 'minRating' to filter restaurants by a minimum rating (default 0).
 * 
 * If the cuisine is not provided, a 400 status code is returned.
 * If the minRating is invalid, a 400 status code is returned.
 * If the operation is successful, a 200 status code is returned with a list of restaurants.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
app.get('/restaurants/cuisine/:cuisine', async (req, res) => {
    const cuisine = req.params.cuisine;
    let limit = parseInt(req.query.limit) || 10;
    limit = Math.min(limit, 100); // Ensure the limit does not exceed 100
    const minRating = parseFloat(req.query.minRating) || 0; // Minimum rating filter

    // Check for missing required fields
    if (!cuisine) {
        console.error('GET /restaurants/cuisine/:cuisine', 'Missing required fields');
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    // Validate the minRating parameter
    if (minRating < 0 || minRating > 5) {
        console.error('GET /restaurants/cuisine/:cuisine', 'Invalid rating');
        res.status(400).send({ success: false, message: 'Invalid rating' });
        return;
    }

    const cacheKey = `${cuisine}_minRating_${minRating}_limit_${limit}`;

    // Check cache if USE_CACHE is enabled
    if (USE_CACHE) {
        try {
            const cachedRestaurants = await memcachedActions.getRestaurants(cacheKey);
            if (cachedRestaurants) {
                // Cache hit: return cached data
                //console.log('Cache hit for:', cacheKey);
                cachedRestaurants.forEach(restaurant => {
                    restaurant.rating = parseFloat(restaurant.rating) || 0;
                });
                res.status(200).json(cachedRestaurants);
                return;
            } else {
                //console.log('Cache miss for:', cacheKey);
            }
        } catch (cacheError) {
            console.error('Error accessing memcached:', cacheError);
        }
    }

    const params = {
        TableName: TABLE_NAME,
        IndexName: 'CuisineIndex',
        KeyConditionExpression: 'Cuisine = :cuisine',
        ExpressionAttributeValues: {
            ':cuisine': cuisine,
        },
        Limit: limit,
        ScanIndexForward: false // Get top-rated restaurants
    };

    try {
        // Query DynamoDB for restaurants by cuisine
        const data = await dynamodb.query(params).promise();

        // Filter results based on minRating
        const filteredRestaurants = data.Items.filter(item => item.Rating >= minRating);

        // Map data to the desired format
        const restaurants = filteredRestaurants.map(item => ({
            cuisine: item.Cuisine,
            name: item.SimpleKey,
            rating: item.Rating,
            region: item.GeoRegion
        }));

        // Add the results to cache if USE_CACHE is enabled
        if (USE_CACHE) {
            try {
                await memcachedActions.addRestaurants(cacheKey, restaurants);
                //console.log('Added to cache:', cacheKey);
            } catch (cacheError) {
                console.error('Error adding to memcached:', cacheError);
            }
        }

        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/cuisine/:cuisine', error);
        res.status(500).send("Internal Server Error");
    }
});


/**
 * Retrieves top-rated restaurants by region.
 * 
 * GET /restaurants/region/:region
 * 
 * This endpoint expects a URL parameter with the geographical region.
 * It supports an optional query parameter 'limit' to limit the number of results (default 10, max 100).
 * 
 * If the region is not provided, a 400 status code is returned.
 * If the operation is successful, a 200 status code is returned with a list of restaurants.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */

app.get('/restaurants/region/:region', async (req, res) => {
    const region = req.params.region;
    let limit = parseInt(req.query.limit) || 10;
    limit = Math.min(limit, 100);

    // Check for missing required fields
    if (!region) {
        console.error('GET /restaurants/region/:region', 'Missing required fields');
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    const params = {
        TableName: TABLE_NAME,
        IndexName: 'GeoRegionIndex',
        KeyConditionExpression: 'GeoRegion = :geoRegion',
        ExpressionAttributeValues: {
            ':geoRegion': region
        },
        Limit: limit,
        ScanIndexForward: false // to get top-rated restaurants
    };

    try {
        // Attempt to query the DynamoDB table
        const data = await dynamodb.query(params).promise();

        // Map the retrieved data to a structured response
        const restaurants = data.Items.map(item => ({
            cuisine: item.Cuisine,
            name: item.SimpleKey,
            rating: item.Rating,
            region: item.GeoRegion
        }));

        // Send the list of restaurants as the response
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/region/:region', error);
        res.status(500).send("Internal Server Error");
    }
});


/**
 * Retrieves top-rated restaurants by region and cuisine.
 * 
 * GET /restaurants/region/:region/cuisine/:cuisine
 * 
 * This endpoint expects URL parameters for the geographical region and the type of cuisine.
 * It supports an optional query parameter 'limit' to limit the number of results (default 10, max 100).
 * 
 * If the region or cuisine is not provided, a 400 status code is returned.
 * If the operation is successful, a 200 status code is returned with a list of restaurants.
 * In case of an internal server error, a 500 status code is returned.
 * 
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */

app.get('/restaurants/region/:region/cuisine/:cuisine', async (req, res) => {
    const region = req.params.region;
    const cuisine = req.params.cuisine;
    let limit = parseInt(req.query.limit) || 10;
    limit = Math.min(limit, 100);

    // Check for missing required fields
    if (!region || !cuisine) {
        console.error('GET /restaurants/region/:region/cuisine/:cuisine', 'Missing required fields');
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    const params = {
        TableName: TABLE_NAME,
        IndexName: 'GeoRegionCuisineIndex',
        KeyConditionExpression: 'GeoRegion = :geoRegion and Cuisine = :cuisine',
        ExpressionAttributeValues: {
            ':geoRegion': region,
            ':cuisine': cuisine
        },
        Limit: limit,
        ScanIndexForward: false // to get top-rated restaurants
    };

    try {
        // Attempt to query the DynamoDB table
        const data = await dynamodb.query(params).promise();

        // Map the retrieved data to a structured response
        const restaurants = data.Items.map(item => ({
            cuisine: item.Cuisine,
            name: item.SimpleKey,
            rating: item.Rating,
            region: item.GeoRegion
        }));

        // Send the list of restaurants as the response
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('GET /restaurants/region/:region/cuisine/:cuisine', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(80, () => {
    console.log('Server is running on http://localhost:80');
});

module.exports = { app };