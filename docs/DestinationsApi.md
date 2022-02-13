# Themeparks.DestinationsApi

All URIs are relative to *https://api.themeparks.wiki/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getDestinations**](DestinationsApi.md#getDestinations) | **GET** /destinations | Get a list of supported destinations available on the live API



## getDestinations

> DestinationsResponse getDestinations()

Get a list of supported destinations available on the live API

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.DestinationsApi();
apiInstance.getDestinations().then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters

This endpoint does not need any parameter.

### Return type

[**DestinationsResponse**](DestinationsResponse.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

