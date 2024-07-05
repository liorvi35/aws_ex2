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

    try {
        // Check if the restaurant already exists in the database
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

    // Parameters for DynamoDB get operation
    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Attempt to retrieve the restaurant data from DynamoDB
        const data = await dynamodb.get(params).promise();

        // Check if the restaurant exists
        if (!data.Item) {
            res.status(404).send({ message: 'Restaurant not found' });
            return;
        }

        // Parse and structure the restaurant data
        const restaurant = {
            name: data.Item.SimpleKey,
            cuisine: data.Item.Cuisine,
            rating: data.Item.Rating || 0,
            region: data.Item.GeoRegion
        };
        
        // Send the restaurant data as the response
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

    // Parameters for DynamoDB get and delete operations
    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Attempt to retrieve the restaurant data from DynamoDB
        const data = await dynamodb.get(params).promise();

        // Check if the restaurant exists
        if (!data.Item) {
            res.status(404).send({ message: 'Restaurant not found' });
            return;
        }

        // Delete the restaurant from DynamoDB
        await dynamodb.delete(params).promise();
        console.log('Restaurant', restaurantName, 'deleted successfully');
        
        // Send a success response
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
    if (!restaurantName || newRating === undefined) {
        console.error('POST /restaurants/rating', 'Missing required fields');
        res.status(400).send({ success: false, message: 'Missing required fields' });
        return;
    }

    // Parameters for DynamoDB get operation
    const params = {
        TableName: TABLE_NAME,
        Key: {
            SimpleKey: restaurantName
        }
    };

    try {
        // Attempt to retrieve the restaurant data from DynamoDB
        const data = await dynamodb.get(params).promise();

        // Check if the restaurant exists
        if (!data.Item) {
            res.status(404).send("Restaurant not found");
            return;
        }

        // Calculate the new average rating
        const oldRating = data.Item.Rating || 0;
        const ratingCount = data.Item.RatingCount || 0;
        const newAverageRating = ((oldRating * ratingCount) + newRating) / (ratingCount + 1);

        // Update parameters for DynamoDB update operation
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

        // Update the restaurant's rating in DynamoDB
        await dynamodb.update(updateParams).promise();

        // Send a success response
        res.status(200).send({ success: true });
    } catch (error) {
        console.error('POST /restaurants/rating', error);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/restaurants/cuisine/:cuisine', async (req, res) => {
    const cuisine = req.params.cuisine;
    let limit = req.query.limit;
    
    // Students TODO: Implement the logic to get top rated restaurants by cuisine
    res.status(404).send("need to implement");
});

app.get('/restaurants/region/:region', async (req, res) => {
    const region = req.params.region;
    let limit = req.query.limit;
    
    // Students TODO: Implement the logic to get top rated restaurants by region
    res.status(404).send("need to implement");
});

app.get('/restaurants/region/:region/cuisine/:cuisine', async (req, res) => {
    const region = req.params.region;
    const cuisine = req.params.cuisine;

    // Students TODO: Implement the logic to get top rated restaurants by region and cuisine
    res.status(404).send("need to implement");
});

app.listen(80, () => {
    console.log('Server is running on http://localhost:80');
});

module.exports = { app };