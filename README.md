# WebsocketSignaling

## Quick Setup

To run the server first you need node.js & npm:
	https://nodejs.org/


Make sure to use the recommended node.js version! Versions with a leading 0
e.g. 0.10.x and other older versions might not work! This application was developed 
using npm 6.9.0 and node version v8.11.3.

After installing run the following commands:
    #get the files
    git clone https://github.com/because-why-not/awrtc_signaling
    
    #install dependencies
    cd awrtc_signaling
    npm install
    
    #compile typescript to java script
    npm run build
    
    #run the server
    cd out
    node server.js
           
The app should print the following lines (or similar) once ready to receive connections:

    websockets/http listening on  { address: '0.0.0.0', family: 'IPv4', port: 80 }
    secure websockets/https listening on  { address: '0.0.0.0', family: 'IPv4', port: 443 }

Shut down using ctrl + c. If the first run was successful then now is a good time to customize it:
1. Set the ports and app url's you want to use via the config.json
2. IMPORTANT: Make sure the ports you set are actually opened in the firewall on your machine and / or the firewall from your provider!!! 
3. Replace the files ssl.crt and ssl.key with your own SSL certificate. If you don't have one: http://letsencrypt.org
4. Use pm2 or similar to automatically start the server on boot

If this was too quick:
You can also find more details tutorials here: https://www.because-why-not.com/webrtc/tutorials-server-side/

## Testing
You can now test if your server is running properly via an URL:

    http://yourip:yourport/

secure connection (this will show a security warning if you use the default ssl.crt / ssl.key):

    https://yourip:yourport/

    
Both pages just show a html file in the "public" folder showing the text "running". If the page fails to load the server might not have started properly or a firewall of your server / provider blocks the port.

Testing with the Unity assets CallApp example:
1. Select the CallApp GameObject and set setting uSignalingUrl and uSecureSignalingUrl to your domain + port + appname. Make sure the URL starts with "ws://" for normal websockets and "wss://" for secure websockets. 
2. Run the app within the Unity editor. Enter a passphrase and press join. Once the asset shows "Waiting for incoming call address: [...]" the connection to your server was successful. The server side log should also show a few messages.
3. Run the app in WebGL to test the SSL settings (WebGL automatically uses SSL due to browser requirements). Make sure to serve the webpage via HTTPS or make sure your browser actually supports running from a file:// or http:// url! 

Testing with awrtc_browser:
1. Build
2. Set the value this.mNetConfig.SignalingUrl to your secure wss:// URL https://github.com/because-why-not/awrtc_browser/blob/master/build/callapp_js.html#L62
3. Run it from a server hosted via HTTPS or make sure your browser supports running it via HTTP / file url's
4. Enter a passphrase + press join. Use the browser log to see messages or errors. Check the server side log as well. 

Other testing advice:
* Make sure to restart your server entirely and make sure it restarts properly
* Check the logs frequently. If pm2 is used you can do it via "pm2 status" and "pm2 logs server" or "pm2 logs awrtc_signaling" (if --name awrtc_signaling was used to start it)
* Make sure to test your own SSL certificate! They must be renewed every few months and the server needs to be restarted. 

If you still have open quests or any problems visit
https://github.com/because-why-not/awrtc_signaling/issues

## Configuration in config.json

example lines in config.json:

	"httpConfig": //settings for ws protocol. Remove this to deactivate ws
	{
		"port": 12776, //port used for incoming connections
		"host": "0.0.0.0" //ip to listen at. 0.0.0.0 for all
	},
	"httpsConfig": //settings for wss protocol
	{
		"port": 12777,
		"host": "0.0.0.0",
		"ssl_key_file": "ssl.key", //your private key
		"ssl_cert_file": "ssl.crt" //your ssl certificate + the certificate of the certification authority
	}

You can change used ports and other details in the file config.json. By
default the app will use two ports 12776 for websockets (ws/http) and 12777 for
secure websockets(wss/https). Many cloud services / hosting provider only 
support one port for a single app which is being set via the PORT environment
variable (process.env.port in node.js). In this case you can only run
ws/http or wss/https in a single app and you should remove either httpConfig or
httpsConfig from the config.json.

Some providers have other restrictions and you might have to change the server.js.
Please check with your hosting provider if you have problems.

It is recommended to use port 80 for ws and 443 for wss if possible! Other ports are more likely to be blocked by firewalls outside of your control e.g. firewalls on the endusers network.


Using HTTPS / WSS for secure connections:
The files ssl.cert and ssl.key contain an example ssl certificate to allow 
testing secure connections via native applications. Browsers / WebGL apps 
will not accept this certificate and trigger a security error. You need to 
replace the files with your own certificate which needs to be created for your
specific domain name.

Also make sure your own ssl.cert will contain two "BEGIN CERTIFICATE" 
sections. One for your certificate and one for the certification authority!
You can find more about this in the server guide & FAQ:
https://www.because-why-not.com/webrtc/tutorials-server-side/
https://because-why-not.com/webrtc/faq/

Other settings:
* "log_verbose": false deactivates the message log. It is recommeded to have this set to true during development / debugging
* "maxPayload": 1048576 changes the same setting for http / https server. Mainly to protect the RAM filling up with a single large message
* "apps": [] a list of apps used with this server. The server will keep the address space separated to avoid connections between different apps
* app "name": "ChatApp" name of the app. Mostly for debugging
* app "path": "/callapp" the url used by the app e.g. ws://mydomain.com/callapp
* app "address_sharing": true  a hack that allows multiple users to use the same address which would otherwise result in an error. All users using the same address are connected to each other
