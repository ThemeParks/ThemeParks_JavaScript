# Themeparks.EntitiesApi

All URIs are relative to *https://api.themeparks.wiki/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getEntity**](EntitiesApi.md#getEntity) | **GET** /entity/{entityID} | Get entity document
[**getEntityChildren**](EntitiesApi.md#getEntityChildren) | **GET** /entity/{entityID}/children | Get all children for a given entity document
[**getEntityLiveData**](EntitiesApi.md#getEntityLiveData) | **GET** /entity/{entityID}/live | Get live data for this entity and any child entities
[**getEntityScheduleUpcoming**](EntitiesApi.md#getEntityScheduleUpcoming) | **GET** /entity/{entityID}/schedule | Get entity schedule
[**getEntityScheduleYearMonth**](EntitiesApi.md#getEntityScheduleYearMonth) | **GET** /entity/{entityID}/schedule/{year}/{month} | Get entity schedule for a specific month and year



## getEntity

> EntityData getEntity(entityID)

Get entity document

Get the full data document for a given entity. You can supply either a GUID or slug string.

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.EntitiesApi();
let entityID = "entityID_example"; // String | Entity ID (or slug) to fetch
apiInstance.getEntity(entityID).then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **entityID** | **String**| Entity ID (or slug) to fetch | 

### Return type

[**EntityData**](EntityData.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json


## getEntityChildren

> EntityChildrenResponse getEntityChildren(entityID)

Get all children for a given entity document

Fetch a list of all the children that belong to this entity. This is recursive, so a destination will return all parks and all rides within those parks.

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.EntitiesApi();
let entityID = "entityID_example"; // String | Entity ID (or slug) to fetch
apiInstance.getEntityChildren(entityID).then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **entityID** | **String**| Entity ID (or slug) to fetch | 

### Return type

[**EntityChildrenResponse**](EntityChildrenResponse.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json


## getEntityLiveData

> EntityLiveDataResponse getEntityLiveData(entityID)

Get live data for this entity and any child entities

Fetch this entity&#39;s live data (queue times, parade times, etc.) as well as all child entities. For a destination, this will include all parks within that destination.

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.EntitiesApi();
let entityID = "entityID_example"; // String | Entity ID (or slug) to fetch
apiInstance.getEntityLiveData(entityID).then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **entityID** | **String**| Entity ID (or slug) to fetch | 

### Return type

[**EntityLiveDataResponse**](EntityLiveDataResponse.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json


## getEntityScheduleUpcoming

> EntityScheduleResponse getEntityScheduleUpcoming(entityID)

Get entity schedule

Fetch this entity&#39;s schedule for the next 30 days

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.EntitiesApi();
let entityID = "entityID_example"; // String | Entity ID (or slug) to fetch
apiInstance.getEntityScheduleUpcoming(entityID).then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **entityID** | **String**| Entity ID (or slug) to fetch | 

### Return type

[**EntityScheduleResponse**](EntityScheduleResponse.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json


## getEntityScheduleYearMonth

> EntityScheduleResponse getEntityScheduleYearMonth(entityID, year, month)

Get entity schedule for a specific month and year

Fetch this entity&#39;s schedule for the supplied year and month

### Example

```javascript
import Themeparks from 'themeparks';

let apiInstance = new Themeparks.EntitiesApi();
let entityID = "entityID_example"; // String | Entity ID (or slug) to fetch
let year = 3.4; // Number | Schedule year to fetch
let month = 3.4; // Number | Schedule month to fetch. Must be a two digit zero-padded month.
apiInstance.getEntityScheduleYearMonth(entityID, year, month).then((data) => {
  console.log('API called successfully. Returned data: ' + data);
}, (error) => {
  console.error(error);
});

```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **entityID** | **String**| Entity ID (or slug) to fetch | 
 **year** | **Number**| Schedule year to fetch | 
 **month** | **Number**| Schedule month to fetch. Must be a two digit zero-padded month. | 

### Return type

[**EntityScheduleResponse**](EntityScheduleResponse.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

