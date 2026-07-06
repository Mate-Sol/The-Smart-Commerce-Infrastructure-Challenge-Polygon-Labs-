import axios from "axios";

export const axiosInstance = axios.create({
  // baseURL: "https://testnet.imdefa.com/api-v2",
  // baseURL: "https://app.imdefa.com/api-v2",
  baseURL: "https://defa.invoicemate.net/api-v2",
  withCredentials: true,
  credentials: "include",
});

export const STELLAR_API_URL = "https://node.imdefa.com/stellar-tnx";

// Add a request interceptor
axiosInstance.interceptors.request.use(
  (config) => {
    // Read token from sessionStorage
    const token = sessionStorage.getItem("accessToken");

    if (token) {
      config.headers["Authorization"] = `${token}`;
    }

    return config;
  },
  (error) => {
    // Handle request error
    return Promise.reject(error);
  },
);
axiosInstance.interceptors.response.use(
  (response) => {
    console.log("Response Status:", response?.status);
    console.log("Response Data:", response?.data);

    // Return just the data from the response
    return response?.data;
  },
  (error) => {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log("Error Status:", error.response.status);
      console.log("Response Data:", error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.log("No response received:", error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.log("Error during request setup:", error.message);
    }

    return Promise.reject(error?.response?.data || error?.message);
  },
);

export const getIP = () => {
  return new Promise((res, rej) => {
    axios
      .get("https://ipinfo.io/json?token=5d6fb996174d78")
      .then(({ data }) => {
        if (data.ip) {
          res(data.ip);
        } else {
          res("");
        }
      })
      .catch((error) => {
        console.log(error);
        rej(error);
      });
  });
};
