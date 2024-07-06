const http = require('http');
const assert = require('assert');


/**
 * @brief the IP address of the load balancer at the current time of writing the tests
 * @note it may change due to future `cdk destroy/deploy`
 */
const endPoint = 'Restau-LB8A1-k6x0CHNrdxHO-237563690.us-east-1.elb.amazonaws.com';


/**
 * @brief the production port of the API
 */
const port = 80;


/**
 * @brief an example name for a restaurant for the testing
 */
const restaurantName = 'exampleRestaurant';


/**
 * @brief an array for cuisine examples
 */
const cuisineName = [
    "cuisine0",
    "cuisine1",
    "cuisine2",
    "cuisine3",
    "cuisine4",
    "cuisine5",
    "cuisine6",
    "cuisine7",
    "cuisine8",
    "cuisine9",
    "cuisine10",
    "cuisine11",
    "cuisine12",
    "cuisine13",
    "cuisine14",
    "cuisine15",
    "cuisine16",
    "cuisine17",
    "cuisine18",
    "cuisine19",
    "cuisine20"
];


/**
 * @brief an array for geoRegion examples
*/
const regionName = [
    "city0",
    "city1",
    "city2",
    "city3",
    "city4",
    "city5",
    "city6",
    "city7",
    "city8",
    "city9",
    "city10",
    "city11",
    "city12",
    "city13",
    "city14",
    "city15",
    "city16",
    "city17",
    "city18",
    "city19",
    "city20"
]


/**
 * @brief number of requests for the stress/load test on the API
 */
const numRequests = 1000000;


/**
 * Makes an HTTP request with the given options and optional post data.
 * @param {Object} options - The HTTP request options (hostname, port, path, method, headers).
 * @param {string} postData - The data to be sent in the request body (for POST requests).
 * @returns {Promise<Object>} - A promise that resolves with the response status code and data.
 */
const makeRequest = (options, postData = null) => {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, data: data });
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }

        req.end();
    });
};

/**
 * Tests the POST method by adding a restaurant.
 * @param {number} i - The index to differentiate restaurant names.
 */
const testPostMethod = async (i) => {
    const RestaurantAName = restaurantName + i;
    const restaurant = { name: RestaurantAName, cuisine: cuisineName[(i % cuisineName.length)], region: regionName[(i % regionName.length)] };

    const postOptions = {
        hostname: endPoint,
        port: port,
        path: '/restaurants',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    try {
        // Make the POST request to add the restaurant
        const startTime = process.hrtime(); // Start time
        const postResponse = await makeRequest(postOptions, JSON.stringify(restaurant));
        const endTime = process.hrtime(startTime); // End time
        const elapsedTimeInMs = ((endTime[0] * 1e9 + endTime[1]) / 1e6).toFixed(2); // Calculate time in milliseconds

        // Assert that the POST request was successful
        assert.strictEqual(postResponse.statusCode, 200, 'Expected POST status code to be 200');

        console.log(`POST ${postOptions.path} Status Code:`, postResponse.statusCode, `; Time Elapsed: ${elapsedTimeInMs}ms`);

    } catch (error) {
        console.error('POST Test failed:', error);
    }
};

/**
 * Tests the GET method by retrieving a restaurant.
 * @param {number} i - The index to differentiate restaurant names.
 */
const testGetMethod = async (i) => {
    const RestaurantAName = restaurantName + i;

    const getOptions = {
        hostname: endPoint,
        port: port,
        path: `/restaurants/${RestaurantAName}`,
        method: 'GET'
    };

    try {
        // Make the GET request to retrieve the added restaurant
        const startTime = process.hrtime(); // Start time
        const getResponse = await makeRequest(getOptions);
        const endTime = process.hrtime(startTime); // End time
        const elapsedTimeInMs = ((endTime[0] * 1e9 + endTime[1]) / 1e6).toFixed(2); // Calculate time in milliseconds

        // Add assertions to validate the GET response
        assert.strictEqual(getResponse.statusCode, 200, 'Expected GET status code to be 200');
        const responseData = JSON.parse(getResponse.data);
        assert.strictEqual(responseData.name, RestaurantAName, 'Expected restaurant name to match');
        assert.strictEqual(responseData.cuisine, cuisineName[(i % cuisineName.length)], 'Expected cuisine to match');
        assert.strictEqual(responseData.region, regionName[(i % regionName.length)], 'Expected region to match');

        console.log(`GET ${getOptions.path} Status Code:`, getResponse.statusCode, `; Time Elapsed: ${elapsedTimeInMs}ms`);

    } catch (error) {
        console.error('GET Test failed:', error);
    }
};


/**
 * Asynchronous function to test the DELETE method for deleting a restaurant.
 *
 * @param {number} i - The index to uniquely identify the restaurant.
 */
const testDeleteMethod = async (i) => {
    const RestaurantAName = 'ArielsRestaurantA' + i;

    // Options for the DELETE request
    const deleteOptions = {
        hostname: endPoint,
        port: port,
        path: `/restaurants/${RestaurantAName}`,
        method: 'DELETE'
    };

    try {
        // Make the DELETE request to delete the restaurant
        const startTime = process.hrtime(); // Start time for measuring request duration
        const deleteResponse = await makeRequest(deleteOptions); // Await response
        const endTime = process.hrtime(startTime); // End time
        const elapsedTimeInMs = ((endTime[0] * 1e9 + endTime[1]) / 1e6).toFixed(2); // Calculate elapsed time in milliseconds

        // Assert that the DELETE request was successful
        assert.strictEqual(deleteResponse.statusCode, 200, 'Expected DELETE status code to be 200');
        const deleteResponseData = JSON.parse(deleteResponse.data);
        assert.deepStrictEqual(deleteResponseData, { success: true }, 'Expected success message');

        // Log the status code and elapsed time
        console.log(`DELETE ${deleteOptions.path} Status Code:`, deleteResponse.statusCode, `; Time Elapsed: ${elapsedTimeInMs}ms`);

    } catch (error) {
        // Log any errors that occur during the DELETE request
        console.error('DELETE Test failed:', error);
    }
};

/**
 * Asynchronous function to perform a load test by making multiple POST, GET, and DELETE requests.
 */
const loadTest = async () => {
    console.log(`Starting load test with ${numRequests} requests`);

    // Test the POST method
    console.log(`[+] Testing POST method`);
    for (let i = 1; i <= numRequests; i++) {
        await testPostMethod(i);
    }

    // Test the GET method three times for each request
    console.log(`[+] Testing GET methods`);
    for (let j = 1; j <= 3; j++) {
        for (let i = 1; i <= numRequests; i++) {
            await testGetMethod(i);
        }
    }

    // Test the DELETE method
    console.log(`[+] Testing DELETE method`);
    for (let i = 1; i <= numRequests; i++) {
        await testDeleteMethod(i);
    }
};

// Start the load test and catch any errors
loadTest().catch(console.error);
