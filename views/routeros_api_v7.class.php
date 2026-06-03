<?php
class RouterOS_v7_API {
    private $host;
    private $user;
    private $pass;
    private $port;
    private $ssl;
    private $curl;

    public function __construct($host, $user, $pass, $port, $ssl = true) {
        $this->host = $host;
        $this->user = $user;
        $this->pass = $pass;
        $this->port = $port;
        $this->ssl = $ssl;
    }

    public function connect() {
        $this->curl = curl_init();
        $protocol = $this->ssl ? 'https://' : 'http://';
        $url = $protocol . $this->host . ':' . $this->port . '/rest/system/resource';

        curl_setopt($this->curl, CURLOPT_URL, $url);
        curl_setopt($this->curl, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($this->curl, CURLOPT_USERPWD, $this->user . ':' . $this->pass);
        curl_setopt($this->curl, CURLOPT_SSL_VERIFYPEER, false); // For self-signed certificates
        curl_setopt($this->curl, CURLOPT_SSL_VERIFYHOST, false); // For self-signed certificates

        $response = curl_exec($this->curl);
        $http_code = curl_getinfo($this->curl, CURLINFO_HTTP_CODE);

        if ($http_code == 200) {
            return true; // Connection successful
        } else {
            return false; // Connection failed
        }
    }

    public function comm($path, $data = []) {
        $protocol = $this->ssl ? 'https://' : 'http://';
        $url = $protocol . $this->host . ':' . $this->port . '/rest' . $path;

        $this->curl = curl_init();

        $jsonData = json_encode($data);

        if (!empty($data)) {
            curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, "POST");
            curl_setopt($this->curl, CURLOPT_POSTFIELDS, $jsonData);
            curl_setopt($this->curl, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'Content-Length: ' . strlen($jsonData)
            ]);
        } else {
            curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, "GET");
        }

        curl_setopt($this->curl, CURLOPT_URL, $url);
        curl_setopt($this->curl, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($this->curl, CURLOPT_USERPWD, $this->user . ':' . $this->pass);
        curl_setopt($this->curl, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($this->curl, CURLOPT_SSL_VERIFYHOST, false);

        $response = curl_exec($this->curl);
        $error = curl_error($this->curl);

        if ($error) {
            return ['!trap' => $error];
        }

        return json_decode($response, true);
    }

    public function disconnect() {
        if ($this->curl) {
            curl_close($this->curl);
        }
    }

    public function __destruct() {
        $this->disconnect();
    }
}
?>