class PreflightCheckerRegistry {
    constructor() {
        this.checkers = {};
    }
    register(id, checker) {
        this.checkers[id] = checker;
    }
}
export const registry = new PreflightCheckerRegistry();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcmVmbGlnaHQvbWFpbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFXQSxNQUFNLHdCQUF3QjtJQUE5QjtRQUNFLGFBQVEsR0FBOEMsRUFBRSxDQUFBO0lBSzFELENBQUM7SUFIQyxRQUFRLENBQUMsRUFBVSxFQUFFLE9BQXlCO1FBQzVDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEdBQUcsT0FBTyxDQUFDO0lBQzlCLENBQUM7Q0FDRjtBQUdELE1BQU0sQ0FBQyxNQUFNLFFBQVEsR0FBRyxJQUFJLHdCQUF3QixFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDaGVja2VyUmVzdWx0cyB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgV29ya3NwYWNlIH0gZnJvbSAnLi4vc3RvcmFnZS93b3Jrc3BhY2UnO1xuXG5cbmludGVyZmFjZSBQcmVmbGlnaHRDaGVja2VyIHtcbiAgaWQ6IHN0cmluZyxcbiAgbGFiZWw6IHN0cmluZyxcbiAgcHJvY2VzczogKHdzOiBXb3Jrc3BhY2UpID0+IFByb21pc2U8Q2hlY2tlclJlc3VsdHM+LFxufVxuXG5cbmNsYXNzIFByZWZsaWdodENoZWNrZXJSZWdpc3RyeSB7XG4gIGNoZWNrZXJzOiB7IFtjaGVja2VySWQ6IHN0cmluZ106IFByZWZsaWdodENoZWNrZXIgfSA9IHt9XG5cbiAgcmVnaXN0ZXIoaWQ6IHN0cmluZywgY2hlY2tlcjogUHJlZmxpZ2h0Q2hlY2tlcikge1xuICAgIHRoaXMuY2hlY2tlcnNbaWRdID0gY2hlY2tlcjtcbiAgfVxufVxuXG5cbmV4cG9ydCBjb25zdCByZWdpc3RyeSA9IG5ldyBQcmVmbGlnaHRDaGVja2VyUmVnaXN0cnkoKTtcbiJdfQ==