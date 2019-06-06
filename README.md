# WebsocketSignaling


To run the server first you need node.js & npm:
	https://nodejs.org/

Make sure to use the recommended node.js version! Versions with a leading 0
e.g. 0.10.x and other older versions might not work! This application was developed 
using node.js version 6.9 and npm v8.9.1.! 

After installing run the following commands:
    
    npm install
            will install all required packages for it to work.
	
	cd out
    node server.js
            will run the server.
            

The app should print the following lines (or similar):

	This app was developed and tested with nodejs v6.9 and v8.9.1. Your current nodejs version: v8.11.3
	websockets/http listening on  { address: '0.0.0.0', family: 'IPv4', port: 12776 }
	secure websockets/https listening on  { address: '0.0.0.0', family: 'IPv4', port: 12777 }


#Configuration config.json: 
You can change used ports and other details in the file config.json. By
default the app will use two ports 12776 for websockets (ws/http) and 12777 for
secure websockets(wss/https). Many cloud services / hosting provider only 
support one port for a single app which is being set via the PORT environment
variable (process.env.port in node.js). In this case you can only run
ws/http or wss/https in a single app and you should remove either httpConfig or
httpsConfig from the config.json.
Some providers have other restrictions and you might have to change the server.js.
Please check with your hosting provider if you have problems.
It is recommended to use port 80 for ws and 443 for wss if possible! Other ports 
are more likely to be blocked by firewalls.

in config.json:
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
	},

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

You can now test if your server is running properly:

Depending on the data in your config.json try visiting following urls:
		http://yourip:yourport/
	and secure connection:
		https://yourip:yourport/
		(this will show a security warning if you use the default ssl.crt / ssl.key)
The two pages should print "running" if the server is active and accessible. If this fails
the most common problem are issues with firewalls / provider specific issues. Please check with
your hosting provider first before asking for support or reporting bugs.

If you still have open quests or any problems visit
https://github.com/because-why-not/awrtc_signaling/issues