
FROM nginx:1.25.1

RUN mkdir -p /usr/share/nginx/html/externel-psp
COPY dist/ /usr/share/nginx/html/externel-psp/

# needed this to make React Router work properly 
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d

RUN service nginx restart

# Expose port 80 for HTTP Traffic 
EXPOSE 80
